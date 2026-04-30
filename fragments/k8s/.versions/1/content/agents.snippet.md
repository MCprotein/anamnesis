## Kubernetes

이 프로젝트는 Kubernetes 매니페스트를 다룬다. 다음 운영 규칙을 따른다.

### Namespace · Service

- 네임스페이스를 워크로드별로 분리. 한 namespace 에 여러 무관한 워크로드 금지.
- `Service` 는 기본 `ClusterIP`. `NodePort` / public `Ingress` 는 외부 노출 이유가 명확할 때만.
- 외부 접근이 필요하면 인증 경계부터 설계.

### Image · Registry

- `latest` 태그 금지. 항상 버전 고정 (semver, digest, 또는 명시적 태그).
- 새 워크로드는 사내 레지스트리(있다면) 미러링 우선 검토.
- 내부·외부 주소 혼용 시 kubelet 인증·DNS 해석 차이를 고려.

### 보안 (PodSecurity)

- 가능하면 기본값으로:
  - `runAsNonRoot: true`
  - `readOnlyRootFilesystem: true`
  - `allowPrivilegeEscalation: false`
  - `capabilities.drop: ["ALL"]`
- secret 은 `Secret` 으로만. `ConfigMap` 에 비밀값 넣지 않음.
- PVC 는 워크로드별 전용. 다른 앱과 공유 금지가 기본.

### 변경

- 매니페스트 변경 시 기존 YAML 스타일 존중 — 작고 명확한 패치.
- 수동 패치 의심 시 바로 덮어쓰지 말고 운영 상태(`kubectl get -o yaml`)와 매니페스트 차이 먼저 확인.

### 검증 순서

1. **정적**: YAML 문법, 참조 이름, 포트, 레이블, selector 연결
2. **배포 전**: namespace, secret, configmap 의존성 존재 여부
3. **배포 후**: pod 상태, service 접근 경로, 로그
