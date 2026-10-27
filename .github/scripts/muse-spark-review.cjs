const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const MODEL = 'muse-spark-1.3-contributor';
const API_URL = 'https://api.meta.ai/v1/chat/completions';
const GUIDE_PATH = '.claude/commands/review-okhub.md';
const BOT_LOGIN = 'github-actions[bot]';
const MARKER = '<!-- muse-spark-review -->';
const STATE_PATTERN = /<!-- muse-spark-state:([A-Za-z0-9+/=]+) -->/;
const EXCLUDES = [
  ':(exclude)pnpm-lock.yaml',
  ':(exclude)package-lock.json',
  ':(exclude)**/*.snap',
  ':(exclude)**/*.zip',
  ':(exclude)**/dist/**',
];
const MAX_DIFF_CHARS = 600000;
const MAX_COMMENT_CHARS = 65000;
const SEVERITY = {
  must: { emoji: '🚨', heading: '🚨 필수 수정', prefix: 'M' },
  should: { emoji: '⚠️', heading: '⚠️ 권장 수정', prefix: 'S' },
};

const THREADS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            isResolved
            comments(first: 1) { nodes { databaseId } }
            replies: comments(last: 1) { nodes { databaseId author { login } body } }
          }
        }
      }
    }
  }`;
const RESOLVE_MUTATION = `
  mutation($id: ID!) {
    resolveReviewThread(input: { threadId: $id }) { thread { isResolved } }
  }`;

// GITHUB_TOKEN으로는 resolveReviewThread가 거부되므로("Resource not accessible
// by integration") 별도 PAT(RESOLVE_TOKEN)가 있을 때만 스레드를 닫는다.
let resolveWarned = false;
async function resolveThread(core, id) {
  const token = process.env.RESOLVE_TOKEN;
  if (!token) {
    if (!resolveWarned) {
      resolveWarned = true;
      core.warning(
        'RESOLVE_TOKEN 시크릿이 없어 review thread 자동 resolve를 건너뜁니다. 대화는 직접 닫아주세요.'
      );
    }
    return false;
  }
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: RESOLVE_MUTATION, variables: { id } }),
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) {
    throw new Error(
      `스레드 resolve 실패: ${res.status} ${(json.errors ?? []).map(e => e.message).join('; ').slice(0, 300)}`
    );
  }
  return true;
}

const SYSTEM_PROMPT = `아래 가이드라인에 따라 PR을 한국어로 리뷰하세요.

반드시 다음 형태의 JSON 객체 하나만 출력하세요. 코드 펜스나 다른 텍스트는 쓰지 마세요.
{
  "summary": "PR 전체에 대한 한두 문장 총평",
  "previous": [{ "id": "M1", "resolved": true, "note": "해결된 방식 한 줄" }],
  "issues": [
    {
      "severity": "must",
      "path": "src/pages/ProjectPage.tsx",
      "line": 42,
      "title": "문제 한 줄 요약",
      "body": "상세 설명. 마크다운 사용 가능, 필요하면 수정 예시 코드 포함"
    }
  ],
  "praises": ["좋은 점"]
}

규칙:
- severity는 반드시 고쳐야 하는 문제면 "must", 권장 사항이면 "should"입니다.
- line은 diff 각 줄 앞에 붙은 번호(변경 후 파일 기준 줄 번호)를 쓰세요. 번호가 붙은 줄만 가리킬 수 있고, 특정 줄이 아니면 null로 두세요.
- "previous"에는 입력으로 주어진 미해결 항목마다 하나씩 넣고, 현재 코드 기준으로 해결 여부를 판단하세요. 미해결 항목이 없으면 빈 배열입니다.
- "issues"에는 이번에 새로 발견한 문제만 넣으세요. 미해결 항목과 같은 문제를 다시 넣지 마세요.
- "사람이 검토하고 닫은 항목"은 작성자가 근거를 들어 반영하지 않기로 했거나 직접 처리한 것입니다. 같은 문제를 표현만 바꿔 다시 넣지 마세요.
- 해당하는 내용이 없으면 빈 배열을 쓰세요.

---

`;

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function commitExists(sha) {
  try {
    git(['cat-file', '-e', `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function parseDiff(diff) {
  const validLines = {};
  const addedLines = {};
  const out = [];
  let path = null;
  let right = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      path = null;
      right = 0;
      out.push(line);
      continue;
    }
    if (line.startsWith('+++ ')) {
      path = line.startsWith('+++ b/') ? line.slice(6) : null;
      out.push(line);
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      right = Number(hunk[1]);
      out.push(line);
      continue;
    }
    if (path && right > 0 && line.startsWith('-')) {
      out.push(`${' '.repeat(6)} ${line}`);
      continue;
    }
    if (path && right > 0 && (line.startsWith('+') || line.startsWith(' '))) {
      (validLines[path] ??= new Set()).add(right);
      if (line.startsWith('+')) (addedLines[path] ??= new Set()).add(right);
      out.push(`${String(right).padStart(6)} ${line}`);
      right++;
      continue;
    }
    out.push(line);
  }

  let annotated = out.join('\n');
  if (annotated.length > MAX_DIFF_CHARS) {
    annotated = `${annotated.slice(0, MAX_DIFF_CHARS)}\n... (diff가 너무 길어 이후 생략)`;
  }
  return { annotated, validLines, addedLines };
}

function parseState(body) {
  const match = body.match(STATE_PATTERN);
  if (!match) return null;
  try {
    return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function trailingParen(text) {
  const trimmed = text.trimEnd();
  if (!trimmed.endsWith(')')) return '';
  let depth = 0;
  for (let i = trimmed.length - 1; i >= 0; i--) {
    if (trimmed[i] === ')') depth++;
    if (trimmed[i] === '(' && --depth === 0) return trimmed.slice(i + 1, -1).trim();
  }
  return '';
}

const MAX_NOTE_CHARS = 200;

function clampNote(text) {
  return text.trim().replace(/\s+/g, ' ').slice(0, MAX_NOTE_CHARS);
}

// 체크한 항목 번호와 번호 뒤의 줄 나머지를 돌려준다.
function checkedItems(body) {
  return new Map(
    [...body.matchAll(/^- \[[xX]\] (?:~~)?\*\*([MS]\d+)\*\*(.*)$/gm)].map(m => [m[1], m[2]])
  );
}

// 제목 뒤 끝 괄호에 적은 내용을 닫은 이유로 본다. 제목 자체의 괄호는 이유로 읽지 않는다.
function checkedNote(rest, title) {
  const at = title ? rest.indexOf(title) : -1;
  const tail = at < 0 ? rest : rest.slice(at + title.length);
  // "코드에서 보기" 링크의 (url) 을 이유로 읽지 않게 마크다운 링크를 먼저 지운다.
  return clampNote(trailingParen(tail.replace(/\[[^\]]*\]\([^)]*\)/g, '')));
}

function parseModelJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('응답에서 JSON을 찾지 못했습니다.');
  const raw = JSON.parse(text.slice(start, end + 1));

  const str = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
  const oneLine = (value, max) => str(value, max).replace(/\s+/g, ' ');
  const list = value => (Array.isArray(value) ? value : []);

  return {
    summary: oneLine(raw.summary, 500),
    previous: list(raw.previous)
      .filter(p => p && typeof p.id === 'string')
      .map(p => ({ id: p.id, resolved: p.resolved === true, note: oneLine(p.note, 200) })),
    issues: list(raw.issues)
      .filter(i => i && SEVERITY[i.severity] && oneLine(i.title, 200))
      .slice(0, 30)
      .map(i => ({
        severity: i.severity,
        path: oneLine(i.path, 300).replace(/^[ab]\//, ''),
        line: Number.isInteger(i.line) && i.line > 0 ? i.line : null,
        title: oneLine(i.title, 200),
        body: str(i.body, 1500),
      })),
    praises: list(raw.praises)
      .map(p => oneLine(p, 300))
      .filter(Boolean)
      .slice(0, 10),
  };
}

function buildMessages({ guide, openIssues, dismissedIssues, incDiff, fullDiff, isFollowUp }) {
  const fence = diff => `\`\`\`diff\n${diff}\n\`\`\``;
  let user;
  if (isFollowUp) {
    const open = openIssues.length
      ? openIssues.map(i => `- ${i.id} \`${location(i)}\` ${i.title}`).join('\n')
      : '(없음)';
    const inc = incDiff
      ? fence(incDiff)
      : '(이전 리뷰 커밋을 찾을 수 없습니다. 전체 diff로 판단하세요.)';
    const dismissed = dismissedIssues.length
      ? dismissedIssues
          .map(i => `- ${i.id} \`${location(i)}\` ${i.title}${i.note ? ` → ${i.note}` : ''}`)
          .join('\n')
      : '(없음)';
    user = [
      '## 이전 리뷰의 미해결 항목',
      open,
      '## 사람이 검토하고 닫은 항목',
      dismissed,
      '## 이전 리뷰 이후 변경된 diff',
      inc,
      '## 현재 PR 전체 diff',
      fence(fullDiff),
    ].join('\n\n');
  } else {
    user = `## PR diff\n\n${fence(fullDiff)}`;
  }
  return [
    { role: 'system', content: SYSTEM_PROMPT + guide },
    { role: 'user', content: user },
  ];
}

async function callModel(core, messages) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.MODEL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: MODEL, messages }),
        signal: AbortSignal.timeout(300000),
      });
      const text = await res.text();
      if (!res.ok) {
        const error = new Error(`Muse Spark API ${res.status}: ${text.slice(0, 500)}`);
        error.retryable = res.status === 429 || res.status >= 500;
        throw error;
      }
      const content = JSON.parse(text).choices?.[0]?.message?.content;
      const message = Array.isArray(content)
        ? content.map(part => part.text ?? '').join('')
        : content;
      if (!message) throw new Error('응답에 content가 없습니다.');
      return parseModelJson(message);
    } catch (error) {
      if (attempt >= 3 || error.retryable === false) throw error;
      core.warning(`Muse Spark 요청 재시도 (${attempt}/3): ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
    }
  }
}

function location(issue) {
  if (!issue.path) return '';
  return issue.line ? `${issue.path}:${issue.line}` : issue.path;
}

function indent(text) {
  return text
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n');
}

function renderInline(issue) {
  return [
    `${SEVERITY[issue.severity].emoji} **${issue.id} · ${issue.title}**`,
    issue.body,
    '<sub>🤖 Muse Spark 자동 리뷰 · 해결되면 다음 리뷰에서 자동으로 resolve 됩니다.</sub>',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function renderIssue(issue, newIds, withBody) {
  const loc = issue.path ? ` \`${location(issue)}\`` : '';
  if (issue.status === 'resolved') {
    const how =
      issue.resolvedBy === 'manual'
        ? `수동 처리${issue.note ? `: ${issue.note}` : ''}`
        : issue.note;
    return `- [x] ~~**${issue.id}**${loc} ${issue.title}~~${how ? ` (해결: ${how})` : ''}`;
  }
  const badge = newIds.has(issue.id) ? ' 🆕' : '';
  const link = issue.commentUrl ? ` · [코드에서 보기](${issue.commentUrl})` : '';
  const head = `- [ ] **${issue.id}**${loc} ${issue.title}${badge}${link}`;
  return withBody && issue.body && !issue.commentUrl ? `${head}\n\n${indent(issue.body)}\n` : head;
}

function renderSummary(state, newIds, withBody = true) {
  const encoded = Buffer.from(JSON.stringify(state)).toString('base64');
  const open = state.issues.filter(i => i.status === 'open').length;
  const archived = state.archivedResolved ?? 0;
  const lines = [MARKER, `<!-- muse-spark-state:${encoded} -->`, '## 🤖 Muse Spark 코드 리뷰', ''];
  if (state.summary) lines.push(state.summary, '');
  lines.push(
    `**해결 ${state.issues.length - open + archived} · 미해결 ${open} · 이번 신규 ${newIds.size}**`,
    ''
  );
  if (archived)
    lines.push(
      `<sub>코멘트 길이 제한으로 해결된 항목 ${archived}건은 목록에서 생략했습니다.</sub>`,
      ''
    );
  if (state.droppedOpen) {
    lines.push(
      `> ⚠️ 코멘트 길이 제한으로 오래된 미해결 항목 ${state.droppedOpen}건을 더 이상 추적하지 않습니다. 인라인 스레드를 확인해 주세요.`,
      ''
    );
  }
  for (const severity of Object.keys(SEVERITY)) {
    const items = state.issues.filter(i => i.severity === severity);
    lines.push(`### ${SEVERITY[severity].heading}`, '');
    lines.push(
      items.length ? items.map(i => renderIssue(i, newIds, withBody)).join('\n') : '- 없음',
      ''
    );
  }
  if (state.praises.length) {
    lines.push('### ✅ 좋은 점', '', ...state.praises.map(p => `- ${p}`), '');
  }
  lines.push(`<sub>마지막 리뷰 커밋: ${state.lastSha.slice(0, 7)} · ${MODEL}</sub>`);
  return lines.join('\n');
}

function renderFitted(state, newIds) {
  const shrinks = [
    () => {},
    () => state.issues.forEach(i => delete i.body),
    // 사람이 닫은 항목은 다음 리뷰에서 같은 지적을 막는 데 쓰이므로 끝까지 남긴다.
    () => {
      const archivable = i => i.status === 'resolved' && i.resolvedBy !== 'manual';
      state.archivedResolved =
        (state.archivedResolved ?? 0) + state.issues.filter(archivable).length;
      state.issues = state.issues.filter(i => !archivable(i));
    },
    () => state.issues.forEach(i => (i.title = i.title.slice(0, 60))),
    () => {
      const resolved = state.issues.filter(i => i.status === 'resolved').length;
      state.archivedResolved = (state.archivedResolved ?? 0) + resolved;
      state.issues = state.issues.filter(i => i.status === 'open');
    },
  ];
  let body = renderSummary(state, newIds);
  if (body.length <= MAX_COMMENT_CHARS) return { body, dropped: [] };
  for (const shrink of shrinks) {
    shrink();
    body = renderSummary(state, newIds, false);
    if (body.length <= MAX_COMMENT_CHARS) return { body, dropped: [] };
  }
  const dropped = [];
  const droppedBefore = state.droppedOpen ?? 0;
  while (body.length > MAX_COMMENT_CHARS && state.issues.length > 1) {
    dropped.push(...state.issues.splice(0, Math.ceil(state.issues.length / 4)).map(i => i.id));
    state.droppedOpen = droppedBefore + dropped.length;
    body = renderSummary(state, newIds, false);
  }
  return { body, dropped };
}

async function fetchThreads(github, owner, repo, number) {
  const threads = new Map();
  let after;
  do {
    const data = await github.graphql(THREADS_QUERY, {
      owner,
      repo,
      number,
      after: after ?? undefined,
    });
    const page = data.repository.pullRequest.reviewThreads ?? {
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    };
    for (const thread of page.nodes) {
      const root = thread.comments.nodes[0];
      if (!root) continue;
      // 답글 없이 resolve 만 한 스레드는 마지막 코멘트가 봇의 원 코멘트라 이유로 보지 않는다.
      const reply = thread.replies.nodes[0];
      const login = reply?.author?.login ?? '';
      const isHumanReply =
        reply && reply.databaseId !== root.databaseId && !/^github-actions$|\[bot\]$/.test(login);
      threads.set(root.databaseId, {
        id: thread.id,
        isResolved: thread.isResolved,
        note: isHumanReply ? clampNote(reply.body ?? '') : '',
      });
    }
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return threads;
}

async function run({ github, context, core }) {
  if (!process.env.MODEL_API_KEY) throw new Error('MODEL_API_KEY 시크릿이 없습니다.');
  const { owner, repo } = context.repo;
  const pr = context.payload.pull_request;
  const headSha = pr.head.sha;

  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: pr.number,
    per_page: 100,
  });
  const prevComment = comments
    .filter(c => c.user?.login === BOT_LOGIN && c.body?.startsWith(MARKER))
    .at(-1);
  const prevState = prevComment ? parseState(prevComment.body) : null;
  const state = prevState ?? {
    lastSha: null,
    nextId: { must: 1, should: 1 },
    issues: [],
    praises: [],
    summary: '',
  };

  if (state.lastSha === headSha) {
    core.notice('이미 리뷰한 커밋이라 건너뜁니다.');
    return;
  }

  const fullDiff = parseDiff(
    git(['diff', `origin/${pr.base.ref}...${headSha}`, '--', '.', ...EXCLUDES])
  );
  if (!fullDiff.annotated.trim()) {
    core.notice('리뷰 대상에서 제외한 파일만 변경되어 건너뜁니다.');
    return;
  }

  const threads = await fetchThreads(github, owner, repo, pr.number);
  const checked = prevComment ? checkedItems(prevComment.body) : new Map();
  const resolvedNow = [];
  for (const issue of state.issues) {
    if (issue.status !== 'open') continue;
    const thread = threads.get(issue.commentId);
    if (checked.has(issue.id) || thread?.isResolved) {
      const note =
        (checked.has(issue.id) && checkedNote(checked.get(issue.id), issue.title)) ||
        thread?.note ||
        '';
      Object.assign(issue, { status: 'resolved', resolvedBy: 'manual', note });
      resolvedNow.push(issue);
    }
  }

  const openIssues = state.issues.filter(i => i.status === 'open');
  const incDiff =
    state.lastSha && commitExists(state.lastSha)
      ? parseDiff(git(['diff', state.lastSha, headSha, '--', '.', ...EXCLUDES])).annotated
      : '';

  const review = await callModel(
    core,
    buildMessages({
      guide: fs.readFileSync(GUIDE_PATH, 'utf8'),
      openIssues,
      dismissedIssues: state.issues.filter(i => i.resolvedBy === 'manual'),
      incDiff,
      fullDiff: fullDiff.annotated,
      isFollowUp: Boolean(prevState),
    })
  );

  const verdicts = new Map(review.previous.map(p => [p.id, p]));
  for (const issue of openIssues) {
    const verdict = verdicts.get(issue.id);
    if (!verdict?.resolved) continue;
    Object.assign(issue, { status: 'resolved', resolvedBy: 'model', note: verdict.note });
    resolvedNow.push(issue);
  }

  for (const issue of state.issues) {
    const thread = threads.get(issue.commentId);
    if (issue.status !== 'resolved' || !thread || thread.isResolved) continue;
    let closed = false;
    try {
      closed = await resolveThread(core, thread.id);
    } catch (error) {
      core.warning(`${issue.id} 스레드 resolve 실패: ${error.message}`);
    }
    if (!closed) {
      // 스레드를 닫지 못했는데 resolved로 두면 다음 실행에서 재시도하지 않으므로,
      // 모델이 해결했다고 본 항목만 open으로 되돌린다(사람이 직접 처리한 항목은 유지).
      if (issue.resolvedBy !== 'manual') {
        Object.assign(issue, { status: 'open' });
        delete issue.resolvedBy;
        delete issue.note;
      }
      continue;
    }
    if (!resolvedNow.includes(issue)) continue;
    try {
      const reason = issue.resolvedBy === 'manual' ? '요약 코멘트에서 수동 체크' : issue.note;
      await github.rest.pulls.createReplyForReviewComment({
        owner,
        repo,
        pull_number: pr.number,
        comment_id: issue.commentId,
        body: `✅ 해결됨${reason ? `: ${reason}` : ''}`,
      });
    } catch (error) {
      core.warning(`${issue.id} 해결 답글 작성 실패: ${error.message}`);
    }
  }

  const newIds = new Set();
  for (const item of review.issues) {
    if (item.path && !fullDiff.validLines[item.path]) continue;
    if (item.line && !fullDiff.validLines[item.path]?.has(item.line)) item.line = null;
    const issue = {
      id: `${SEVERITY[item.severity].prefix}${state.nextId[item.severity]++}`,
      ...item,
      status: 'open',
    };
    newIds.add(issue.id);
    if (issue.severity === 'must' && fullDiff.addedLines[issue.path]?.has(issue.line)) {
      try {
        const { data } = await github.rest.pulls.createReviewComment({
          owner,
          repo,
          pull_number: pr.number,
          commit_id: headSha,
          path: issue.path,
          line: issue.line,
          side: 'RIGHT',
          body: renderInline(issue),
        });
        Object.assign(issue, { commentId: data.id, commentUrl: data.html_url });
        delete issue.body;
      } catch (error) {
        core.warning(`${issue.id} 인라인 코멘트 작성 실패: ${error.message}`);
      }
    }
    state.issues.push(issue);
  }

  Object.assign(state, { lastSha: headSha, summary: review.summary, praises: review.praises });
  const { body, dropped } = renderFitted(state, newIds);
  if (dropped.length) {
    core.warning(`코멘트 길이 제한으로 미해결 항목 추적 중단: ${dropped.join(', ')}`);
  }

  if (prevComment) {
    await github.rest.issues.updateComment({ owner, repo, comment_id: prevComment.id, body });
  } else {
    await github.rest.issues.createComment({ owner, repo, issue_number: pr.number, body });
  }
}

module.exports = run;
module.exports.parseDiff = parseDiff;
module.exports.parseState = parseState;
module.exports.checkedItems = checkedItems;
module.exports.checkedNote = checkedNote;
module.exports.parseModelJson = parseModelJson;
module.exports.renderSummary = renderSummary;
module.exports.renderFitted = renderFitted;
module.exports.fetchThreads = fetchThreads;
