## Django

이 프로젝트는 Django 애플리케이션으로 취급한다.

### 앱 경계

- Django app 은 domain capability 단위로 유지한다.
- view 는 request/response orchestration 중심으로 두고, 복잡한 비즈니스 규칙은 model method, manager/queryset, service module 로 분리한다.
- `settings.py` 계열 파일을 수정할 때는 environment 분리와 secret 노출을 먼저 확인한다.

### 데이터와 ORM

- DB schema 변경은 migration 으로만 수행한다.
- queryset 은 lazy evaluation 을 고려한다. loop 안 query, template N+1 을 피한다.
- cross-row consistency 는 `transaction.atomic()` 과 database constraint 를 함께 검토한다.
- custom manager/queryset 은 재사용되는 query intent 를 이름으로 드러낼 때만 추가한다.

### 라우팅과 입출력

- URLConf 는 domain app 별로 분리하고 project root 에서 include 한다.
- form/serializer 는 입력 검증 경계다. view 에서 raw dict 를 직접 신뢰하지 않는다.
- DRF 프로젝트라면 serializer/viewset/router conventions 를 우선 따른다.

### 검증

- 프로젝트 runner 우선. 일반적으로 `python manage.py test`, `python manage.py check`, `python manage.py showmigrations` 를 확인한다.
- pytest-django 를 쓰는 repo 는 `pytest` 설정을 따른다.

### 흔한 실수

- migration 없이 model field 만 수정하기.
- settings 에 secret 값 커밋하기.
- template 렌더링 중 N+1 query 만들기.
- signal 에 복잡한 비즈니스 workflow 숨기기.
