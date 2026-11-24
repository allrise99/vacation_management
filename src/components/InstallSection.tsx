import { isIOS, isStandalone, useInstallPrompt } from '../lib/pwa';

/** 설정 시트: 휴대폰 홈 화면에 앱으로 추가하는 방법 */
export function InstallSection() {
  const install = useInstallPrompt();
  if (isStandalone()) return null;
  const ios = isIOS();
  return (
    <section>
      <h3>휴대폰 홈 화면에 앱으로 추가</h3>
      <p className="hint">
        홈 화면 아이콘을 누르면 주소창 없이 앱처럼 열립니다. 인터넷이 없어도 열리고, 기록은 동기화로 그대로 이어집니다.
      </p>
      {install && (
        <button type="button" className="button primary" onClick={() => void install()}>
          앱으로 설치
        </button>
      )}
      <ol className="install-steps">
        {ios ? (
          <>
            <li>
              <b>Safari</b>에서 이 페이지를 엽니다.
            </li>
            <li>
              아래쪽(또는 위쪽)의 <b>공유 버튼</b>(□↑)을 누릅니다.
            </li>
            <li>
              <b>홈 화면에 추가</b>를 누르고 <b>추가</b>를 누릅니다.
            </li>
          </>
        ) : (
          <>
            <li>
              <b>Chrome</b>(삼성 인터넷도 가능)에서 이 페이지를 엽니다.
            </li>
            <li>
              오른쪽 위 <b>⋮ 메뉴</b>를 누릅니다.
            </li>
            <li>
              <b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 누릅니다.
            </li>
          </>
        )}
      </ol>
      {ios && (
        <p className="hint warn">
          아이폰은 홈 화면 앱이 Safari와 저장 공간을 따로 씁니다. 앱을 처음 열면 <b>앱 안에서 한 번 더 로그인</b>하세요.
          이때는 메일의 링크 대신 <b>숫자 코드</b>를 입력해야 합니다.
        </p>
      )}
    </section>
  );
}
