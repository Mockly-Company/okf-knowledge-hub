# GitHub 인증 정보 저장과 macOS Keychain

이 문서는 OkHub가 GitHub Access Token과 Refresh Token을 운영체제 보안 저장소에 보관할 때 필요한 개념, 2026년 8월에 확인한 macOS 개발 환경 오류, 그리고 후속 구현 판단 기준을 기록한다.

토큰은 Rust 계층에서만 다룬다. React 상태, Tauri command 응답, Tauri event, 일반 설정 파일과 로그에는 토큰을 넣지 않는다. 앱 실행 중에는 Rust 프로세스의 메모리 인증 세션을 사용하여 매 요청마다 보안 저장소를 다시 읽지 않는다.

## 먼저 이해할 네 가지 개념

### 코드 서명

코드 서명(code signing)은 실행 파일에 제작자와 무결성 정보를 연결하는 전자 서명이다. macOS는 서명을 사용하여 이전에 권한을 받은 앱과 현재 실행 중인 앱이 같은 주체의 앱인지 판단한다.

코드 서명은 단순히 “앱 파일에 이름을 붙이는 것”이 아니다. 서명에는 앱 식별자, 개발 팀 식별자, entitlement 같은 보안 정보가 결합될 수 있다.

- 정식 배포 앱: 개발자가 Apple Developer 인증서와 배포 설정으로 서명한다.
- 로컬 `tauri dev`: 일반적으로 `cargo run`으로 생성된 개발 바이너리를 실행한다. 이 바이너리는 정식 배포 서명이 아니라 ad-hoc 또는 linker signature만 가질 수 있다.
- 일반 사용자: 개발자가 서명한 앱을 설치하므로 사용자 각자가 인증서를 만들 필요가 없다.
- 소스를 내려받아 직접 개발하는 사람: 정식 서명 설정 없이 `tauri dev`를 실행할 수 있어야 한다면 별도의 개발 호환 전략이 필요하다.

현재 실행 파일의 서명 상태는 다음 명령으로 확인한다.

```bash
codesign -dv --verbose=4 /path/to/okhub
```

주요 확인 항목은 `Signature`, `TeamIdentifier`, `Identifier`이다.

### Entitlement

Entitlement는 코드 서명에 포함되는 “이 앱이 어떤 보호된 기능이나 자원에 접근할 수 있는가”에 대한 권한 선언이다.

Keychain과 관련해서는 다음 값들이 앱이 사용할 수 있는 Access Group을 결정하는 데 관여한다.

- `keychain-access-groups`
- `application-identifier` 또는 macOS의 `com.apple.application-identifier`
- 일부 구성의 `com.apple.security.application-groups`

entitlement 파일을 프로젝트에 두는 것만으로 권한이 생기지는 않는다. 실제 빌드 결과물의 코드 서명에 포함되어야 하며, 제한된 entitlement는 적절한 provisioning profile과 개발 팀의 승인을 받아야 한다.

실제 실행 파일에 포함된 entitlement는 다음 명령으로 확인한다.

```bash
codesign -d --entitlements :- /path/to/okhub
```

### Access Group

Access Group은 Data Protection Keychain 안에서 어떤 앱들이 같은 항목에 접근할 수 있는지를 구분하는 보안 경계다.

```text
Data Protection Keychain
└─ Access Group A
   ├─ App A가 저장한 항목
   └─ 같은 그룹 권한을 가진 App B가 접근 가능한 항목
```

Keychain 항목은 하나의 Access Group에 속한다. 앱은 코드 서명과 entitlement로 허용된 그룹에만 접근할 수 있다.

새 항목을 저장할 때 `kSecAttrAccessGroup`을 생략하면 시스템은 앱의 기본 Access Group을 사용한다. 하지만 실행 파일에 기본 그룹을 구성할 `application-identifier`나 관련 entitlement가 없다면 저장이 `errSecMissingEntitlement`로 실패할 수 있다.

### Provisioning profile

Provisioning profile은 특정 개발 팀과 앱 식별자가 사용할 수 있는 entitlement를 Apple이 승인했음을 나타내는 배포·개발 정보다. Data Protection Keychain은 앱의 코드 서명과 entitlement를 기준으로 Access Group을 결정하므로, 정식 배포 경로에서는 signing과 provisioning을 함께 구성해야 한다.

일반 사용자가 profile을 만들거나 설치하는 구조가 아니다. 앱을 빌드하고 배포하는 개발자가 준비한다.

## macOS의 두 Keychain 구현

macOS에는 역사적으로 서로 다른 두 Keychain 구현이 공존한다.

| 구분 | 파일 기반 Keychain | Data Protection Keychain |
|---|---|---|
| 기원 | 전통적인 macOS Keychain | iOS 계열의 최신 Keychain 모델 |
| 접근 API | `SecKeychain` 또는 `SecItem` | `SecItem` |
| 접근 제어 | 실행 파일과 ACL 중심 | 코드 서명 기반 Access Group 중심 |
| 개발 바이너리 | entitlement 없이도 사용 가능 | 유효한 signing identity와 entitlement가 필요할 수 있음 |
| 반복 빌드 | 새 실행 파일로 인식되어 암호를 다시 물을 수 있음 | 동일한 서명·식별자를 유지하면 앱 업데이트에 안정적 |
| Apple 권장 | 기존 항목 호환에 사용 | 새 코드의 기본 선택으로 권장 |

`SecItem`은 API의 이름이고, Data Protection Keychain은 저장 구현의 이름이다. `SecItem`을 사용한다고 항상 Data Protection Keychain을 사용하는 것은 아니다. macOS에서 `kSecUseDataProtectionKeychain = true`를 설정해야 명시적으로 Data Protection Keychain을 선택한다.

Apple 참고 문서:

- [TN3137: On Mac keychain APIs and implementations](https://developer.apple.com/documentation/Technotes/tn3137-on-mac-keychains)
- [kSecUseDataProtectionKeychain](https://developer.apple.com/documentation/security/ksecusedataprotectionkeychain)
- [Sharing access to keychain items among a collection of apps](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps)

## 2026년 8월 오류 조사 기록

### 증상

GitHub Device Flow 인증을 완료한 직후 앱이 다음 오류를 표시했다.

```text
연결을 완료하지 못했습니다.
운영체제 보안 저장소를 사용할 수 없습니다.
```

이 메시지는 토큰이나 운영체제의 상세 오류를 사용자 화면에 노출하지 않기 위한 공개 오류다. 원인을 확인하려면 개발 로그의 내부 `OSStatus`가 필요하다.

### 중복 실행 여부

OkHub가 두 번 실행되어 저장 요청이 중복됐을 가능성을 먼저 확인했다. 기존 프로세스를 모두 종료하고 `pnpm tauri dev`를 정확히 한 번 실행한 상태에서 실제 GUI 바이너리는 한 개만 존재했다.

```text
/Users/hyeeun/.cargo/targets/okhub/debug/okhub
```

단일 프로세스에서도 같은 오류가 재현되었으므로 중복 실행은 이번 저장 실패의 직접 원인이 아니다. 다만 여러 개발 세션을 동시에 실행하면 Keychain 접근이나 로그인 작업도 중복될 수 있으므로 수동 검증 전에는 실행 중인 인스턴스를 정리해야 한다.

### 실제 실패 단계와 오류 코드

민감한 토큰 내용은 출력하지 않고 `load`, `save`, `delete` 중 실패한 작업과 숫자 코드만 개발 로그에 기록했다. 그 결과는 다음과 같았다.

```text
Data Protection Keychain save failed with OSStatus -34018
```

- 실패 단계: GitHub 인증 완료 후 토큰 `save`
- 오류 코드: `-34018`
- 의미: `errSecMissingEntitlement`

Device Flow나 GitHub 토큰 발급이 실패한 것이 아니다. GitHub 인증은 끝났지만 발급된 토큰을 Data Protection Keychain에 저장하는 마지막 단계에서 실패했다.

### 실행 파일의 서명 상태

실제 `tauri dev` 바이너리를 검사한 결과는 다음과 같았다.

```text
Signature=adhoc
TeamIdentifier=not set
entitlements 없음
```

실행 흐름은 다음과 같다.

```text
pnpm tauri dev
→ cargo run
→ target/debug/okhub 실행
→ GitHub Device Flow 완료
→ Data Protection Keychain에 토큰 저장 시도
→ 기본 Access Group을 결정할 entitlement가 없음
→ -34018 errSecMissingEntitlement
```

따라서 이번 오류의 근본 원인은 다음과 같다.

> 정식 서명과 Access Group entitlement가 없는 `tauri dev` 바이너리가 Data Protection Keychain에 새 항목을 저장하려 했다.

## 개발 실행과 공식 배포의 차이

### 공식 배포 앱

공식 배포 앱은 OkHub 개발자가 서명·프로비저닝하여 제공한다. 일반 사용자는 별도의 Apple Developer 인증서나 로컬 인증서를 만들 필요가 없다.

목표 흐름은 다음과 같다.

```text
개발자가 앱 서명·프로비저닝
→ application identifier와 Access Group 권한 포함
→ 사용자가 서명된 앱 설치
→ Data Protection Keychain 사용
```

### 로컬 개발과 직접 빌드

오픈소스 기여자가 저장소를 clone하여 `pnpm tauri dev`를 실행하는 경우, 정식 Apple signing과 provisioning이 없을 수 있다. 이 환경에서 Data Protection Keychain만 강제하면 개발자마다 Apple Developer 설정을 요구하게 된다.

OkHub의 재사용 가능한 오픈소스 도구라는 목표를 유지하려면 로컬 개발 환경도 별도의 Apple 인증서 준비 없이 실행할 수 있어야 한다.

## 확정한 개발·배포 저장 전략

빌드 종류에 따라 저장 backend와 service namespace를 명시적으로 분리한다.

```text
macOS release 빌드
└─ Data Protection Keychain
   └─ com.okhub.desktop.github

macOS debug 빌드와 tauri dev
└─ SecItem 기반 파일 Keychain
   └─ com.okhub.desktop.github.dev

Windows
└─ Windows Credential Manager

앱 실행 중
└─ Rust 메모리 인증 세션
```

이 정책의 의도는 다음과 같다.

- 공식 앱은 Apple이 권장하는 Data Protection Keychain을 사용한다.
- 로컬 개발자는 각자 Apple 인증서를 만들지 않아도 된다.
- 개발 호환 경로도 오래된 `SecKeychain` 래퍼 대신 가능하면 `SecItem` API를 사용한다.
- 실행 중 오류를 보고 다른 backend로 자동 fallback하지 않는다. 어떤 저장소를 쓰는지는 빌드 종류로 결정한다.
- release 빌드에 필요한 signing·provisioning·entitlement가 없으면 Data Protection Keychain 작업은 안전한 공개 오류로 실패한다.
- 토큰은 어느 경로에서도 React, event, command 결과와 일반 설정 파일에 포함하지 않는다.
- 한 번 불러온 토큰은 Rust 메모리 인증 세션에서 사용하여 같은 실행 중 Keychain 반복 조회를 피한다.

개발용과 공식 앱의 service namespace가 다르므로 기존 항목의 ACL이나 손상 상태가 서로 영향을 주지 않는다. 자동 마이그레이션은 하지 않으며, 각 환경에서 최초 한 번 로그인한다.

파일 기반 Keychain은 개발 바이너리가 다시 빌드될 때 새 실행 파일로 판단되어 암호를 다시 물을 가능성이 있다. 따라서 이 경로는 공식 배포의 대체물이 아니라 로컬 개발 호환 경로다.

현재 release 빌드가 Data Protection Keychain을 사용한다는 사실만으로 배포 준비가 끝나는 것은 아니다. 공식 Apple signing·provisioning 구성과 unsigned release 직접 배포 지원은 별도 배포 작업으로 남긴다.

별도 배포 작업에서 결정할 항목:

1. 공식 macOS build의 signing, provisioning, Access Group 값을 어디서 주입하고 검증할지
2. 소스에서 직접 만든 unsigned release를 지원할지
3. CI에서 실제 build entitlement와 토큰 비노출 계약을 어떻게 검증할지

## 별도 조사: 파일 Keychain 암호 창 중복 표시

파일 Keychain에서 한 번의 인증 과정 중 암호 창이 2회, 일부 실행에서는 4~5회 나타난 현상은 Data Protection Keychain의 `-34018`과 다른 문제다. 현재 원인은 확정하지 않았다.

개발 로그로 프로세스 ID, credential operation ID, AuthService 요청 횟수, `load/save/delete`, `SecItemAdd`와 duplicate 이후 update 결과를 연결하고 다음 순서로 재현한다.

1. 개발용 credential 항목이 없는 상태에서 최초 로그인
2. 같은 실행에서 기능 사용
3. 같은 실행에서 로그아웃 후 재로그인
4. 재빌드 없이 앱 종료·재실행
5. 바이너리 재빌드 후 재실행

프롬프트 시점과 로그를 대조하여 중복 AuthService 호출, 하나의 save 내부 add/update, 복수 프로세스, 재빌드에 따른 ACL 신원 변경, 기존 항목의 ACL·손상 중 실제 원인을 구분한다. 원인을 코드·macOS 로그·재현 순서로 먼저 보고한 뒤 별도 승인을 받아 수정한다.

## 오류 코드와 진단 체크리스트

### 주요 오류 코드

| 코드 | 이름 | 해석 |
|---|---|---|
| `-34018` | `errSecMissingEntitlement` | 요청한 Access Group을 사용할 entitlement가 없음 |
| `-25300` | `errSecItemNotFound` | 저장된 항목이 없음. 로그인 전에는 정상 상태일 수 있음 |

### 재현 전

1. 실행 중인 OkHub 개발 세션을 모두 종료한다.
2. `pnpm tauri dev`를 한 번만 실행한다.
3. 실제 GUI 프로세스가 한 개인지 확인한다.
4. `OKHUB_GITHUB_CLIENT_ID`가 현재 실행 환경에 전달됐는지 확인한다.

### 서명과 entitlement 확인

```bash
codesign -dv --verbose=4 /path/to/okhub
codesign -d --entitlements :- /path/to/okhub
```

Data Protection Keychain을 기대한다면 다음을 확인한다.

- `TeamIdentifier`가 존재하는가?
- `application-identifier`가 실제 코드 서명에 포함됐는가?
- 필요한 Access Group이 entitlement에 포함됐는가?
- entitlement가 provisioning profile의 허용 범위와 일치하는가?
- 테스트한 파일이 실제 실행 중인 바이너리와 동일한가?

### 로그 원칙

- 개발 로그에는 작업 이름과 `OSStatus`만 기록한다.
- Access Token, Refresh Token, 직렬화한 credential record는 출력하지 않는다.
- 사용자 화면에는 내부 코드 대신 안전한 공개 오류를 표시한다.
- `errSecItemNotFound`는 로그인하지 않은 정상 상태와 구분한다.

## 보안 경계 요약

```text
GitHub token
→ Rust 인증 서비스
→ 운영체제 보안 저장소에 암호화 보관
→ 앱 실행 중 Rust 메모리 세션에서 사용

전달하지 않는 곳
├─ React state
├─ Tauri command 응답
├─ Tauri event
├─ settings.json
└─ 일반 로그
```

Rust 프로세스 메모리도 완전히 공격 불가능한 장소는 아니다. 같은 사용자 권한으로 디버깅하거나 프로세스 메모리를 읽을 수 있는 악성 코드가 있다면 탈취 가능성이 있다. 여기서의 목표는 토큰을 브라우저 UI 상태와 직렬화 경계에 불필요하게 복제하지 않고, 평상시 디스크에는 운영체제 보안 저장소만 사용하여 노출 면적을 줄이는 것이다.
