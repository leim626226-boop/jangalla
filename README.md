# 부산기계공고 소통망 MVP

별도 서버나 npm 설치 없이 HTML, CSS, JavaScript만으로 실행하는 정적 MVP입니다.

## 실행

- `index.html`을 브라우저에서 열면 됩니다.
- 글, 댓글, 추천·비추천은 브라우저의 `localStorage`에 저장됩니다.
- 저장 데이터는 해당 브라우저에만 남으며 다른 기기나 방문자와 공유되지 않습니다.
- 로그인·학생증 인증, 파일 업로드, 서버 간 데이터 공유는 정적 사이트에서 제공하지 않습니다.

## GitHub Pages 배포

`main` 브랜치에 push하면 `.github/workflows/pages.yml`이 `index.html`과 `public/` 파일만 GitHub Pages에 배포합니다.

처음 한 번 저장소 **Settings → Pages → Build and deployment → Source**에서 **GitHub Actions**를 선택하세요. 배포가 완료되면 같은 설정 페이지에 사이트 주소가 표시됩니다.

## 저장소 데이터 관련

`data/`는 `.gitignore`에 포함되어 새 데이터베이스나 업로드 사진이 추가되지 않습니다. 이전 Git 이력에는 데이터베이스와 인증 사진이 포함된 커밋이 있으므로, 저장소를 공개하기 전에 Git 이력에서도 해당 파일을 제거해야 합니다.
