# GitHub App과 로컬 개발 설정

OkHub의 GitHub 연결은 `Mockly-Company`가 소유한 공개 GitHub App과 Device Flow를 사용한다. 이 문서는 로컬 개발과 수동 smoke test에 필요한 등록값과 보안 경계를 설명한다.

## GitHub App 등록

GitHub App 설정에서 다음을 확인한다.

- Owner: `Mockly-Company`
- 공개 설치를 허용하는 Public GitHub App
- Device Flow enabled
- Expiring user-to-server tokens enabled
- Repository permissions: Metadata **Read**, Contents **Read and write**, Pull requests **Read and write**

새 App을 등록하거나 기존 App을 수정하는 경로는 GitHub의 [GitHub App registration guide](https://docs.github.com/en/apps/maintaining-github-apps/modifying-a-github-app-registration)를 따른다. 권한의 목적과 최소 권한 선택은 [GitHub App permissions guide](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)를 참고한다. 설치할 때는 기본적으로 **Only select repositories**를 권장하고, smoke test용 disposable knowledge repository만 선택한다.

Device Flow와 expiring user access token은 GitHub App 설정에서 명시적으로 활성화해야 한다. GitHub는 만료되는 user access token 사용을 권장하며, 기본 access token 수명은 8시간, refresh token 수명은 6개월이다. Device Flow로 발급된 token refresh에는 Client Secret이 필요하지 않다. 자세한 흐름은 [GitHub App user access token guide](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)를 따른다.

## 공개 Client ID 설정

`OKHUB_GITHUB_CLIENT_ID`에는 GitHub App의 **Client ID**만 넣는다. 이는 공개 build value이며 secret이 아니다. 로컬 개발에서는 실행 환경에 설정한다.

```bash
export OKHUB_GITHUB_CLIENT_ID="Iv1_your_public_client_id"
pnpm tauri dev
```

데스크톱 앱 구성, `.env`, `settings.json`, Git 저장소에는 Client Secret이나 GitHub App private key를 넣지 않는다. OkHub의 Device Flow와 token refresh에는 둘 다 필요하지 않다.

## 자격 증명 저장 위치와 로그아웃

Access Token과 Refresh Token은 Rust 계층에서만 다루며, 일반 로컬 설정 파일에는 저장하지 않는다. 현재 native credential entry는 다음과 같다.

| OS | 위치 | entry |
|---|---|---|
| macOS | Keychain Access → login keychain | service `com.okhub.desktop.github`, account `current-user` |
| Windows | Credential Manager → Windows Credentials | target/service `com.okhub.desktop.github`, account `current-user` |

개발 중 로그아웃은 Tauri command `logout_github`를 호출한다. 이 command는 OS credential entry만 삭제하고, `settings.json`의 현재 workspace 연결과 어떠한 local clone도 삭제하지 않는다. 현재 설정 화면에 전용 Logout control이 연결되기 전에는 Tauri devtools 또는 integration harness에서 `logout_github`를 호출해 확인한다.

```ts
await invoke("logout_github");
```

Keychain Access 또는 Credential Manager에서 위 entry가 사라졌는지 확인하고, 연결했던 clone 폴더와 `settings.json`의 workspace path가 유지되는지 확인한다.

## Disposable repository smoke test

1. GitHub에서 disposable knowledge repository를 만든다. 실제 제품 또는 운영 지식 저장소를 사용하지 않는다.
2. 공개 GitHub App을 해당 repository에 설치한다. **Only select repositories**를 쓴 경우 방금 만든 repository만 선택한다.
3. `OKHUB_GITHUB_CLIENT_ID`를 설정하고 `pnpm tauri dev`로 앱을 시작한다.
4. Device Flow URL과 user code를 사용해 로그인한다. OS credential entry가 생성되고 `settings.json`에는 token이 없는지 확인한다.
5. repository 목록에서 disposable repository만 선택해 existing clone 또는 새 parent directory clone 경로를 확인한다.
6. 빈 저장소는 초기화 preview를 확인한 뒤 승인하여 기본 branch 초기화 경로를 검증한다. 콘텐츠가 있는 저장소는 `okf/init-workspace` branch, 한 개의 Draft PR, 그리고 remote push 결과를 확인한다.
7. 로그아웃 후 credential entry만 사라지고 local clone은 남는지 확인한다. 상세 acceptance matrix는 구현 PR의 Test Plan에 기록한다.

수동 smoke test에는 실제 GitHub App Client ID, App 설치 권한, disposable repository, macOS 또는 Windows keychain access가 필요하다. 자동 CI와 pull request job에는 GitHub token을 주입하지 않는다.
