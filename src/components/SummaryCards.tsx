import {
  type LeaveBalance,
  type YearSummary,
  MAX_COMPENSABLE_ANNUAL_DAYS,
  MAX_SPECIAL_SEGMENTS,
  formatDays,
} from '../lib/leave';

interface Props {
  summary: YearSummary;
  onSetGranted: () => void;
}

export function SummaryCards({ summary, onSetGranted }: Props) {
  const { annual, special } = summary;
  return (
    <section className="summary" aria-label={`${summary.year}년 휴가 현황`}>
      <article className="hero-card">
        <div className="hero-top">
          <span className="hero-label">{summary.year}년 남은 연차</span>
          <button type="button" className="link-button on-dark" onClick={onSetGranted}>
            부여일수 설정
          </button>
        </div>
        {summary.annualConfigured ? (
          <>
            <p className="hero-value">
              <strong>{trimDays(annual.remaining)}</strong>
              <span>일</span>
            </p>
            <p className="hero-sub">
              예정 반영 후 <b>{formatDays(annual.remainingAfterPlanned)}</b> · 부여 {formatDays(annual.granted)}
            </p>
            <Meter balance={annual} />
          </>
        ) : (
          <div className="hero-empty">
            <p>올해 연차 부여일수를 아직 설정하지 않았습니다.</p>
            <button type="button" className="button light" onClick={onSetGranted}>
              연차 부여일수 설정하기
            </button>
          </div>
        )}
      </article>

      <BalanceCard title="연차" balance={annual} tone="annual" muted={!summary.annualConfigured}>
        <p className="note">
          보상 예상 <b>{formatDays(summary.compensableAnnual)}</b>
          <span className="dim"> (최대 {MAX_COMPENSABLE_ANNUAL_DAYS}일)</span>
          {summary.forfeitedAnnual > 0 && (
            <span className="warn"> · 한도 초과분 {formatDays(summary.forfeitedAnnual)}은 소멸</span>
          )}
        </p>
      </BalanceCard>

      <BalanceCard title="특별휴가" balance={special} tone="special">
        <p className="note">
          사용 {summary.specialSegmentsUsed}/{MAX_SPECIAL_SEGMENTS}회 (한 번 분할 가능)
          {summary.forfeitedSpecial > 0 && (
            <span className="warn"> · 미사용 {formatDays(summary.forfeitedSpecial)}은 보상 없이 소멸</span>
          )}
        </p>
      </BalanceCard>
    </section>
  );
}

function BalanceCard({
  title,
  balance,
  tone,
  muted,
  children,
}: {
  title: string;
  balance: LeaveBalance;
  tone: 'annual' | 'special';
  muted?: boolean;
  children?: React.ReactNode;
}) {
  const rows: [string, number, string?][] = [
    ['총 부여', balance.granted],
    ['사용 완료', balance.used],
    ['사용 예정', balance.planned],
    ['현재 잔여', balance.remaining, 'strong'],
    ['예정 반영 후 잔여', balance.remainingAfterPlanned, 'strong'],
  ];
  return (
    <article className={`card balance-card tone-${tone}${muted ? ' muted' : ''}`}>
      <h3>
        <span className={`dot ${tone}`} aria-hidden="true" />
        {title}
      </h3>
      <dl className="stat-grid">
        {rows.map(([label, value, cls]) => (
          <div key={label} className={cls}>
            <dt>{label}</dt>
            <dd className={value < 0 ? 'negative' : undefined}>{formatDays(value)}</dd>
          </div>
        ))}
      </dl>
      {children}
    </article>
  );
}

function Meter({ balance }: { balance: LeaveBalance }) {
  const total = Math.max(balance.granted, balance.used + balance.planned, 1);
  const usedPct = (balance.used / total) * 100;
  const plannedPct = (balance.planned / total) * 100;
  return (
    <div
      className="meter"
      role="img"
      aria-label={`사용 ${balance.used}일, 예정 ${balance.planned}일, 부여 ${balance.granted}일`}
    >
      <span className="meter-used" style={{ width: `${usedPct}%` }} />
      <span className="meter-planned" style={{ width: `${plannedPct}%` }} />
      <div className="meter-legend">
        <span>
          <i className="sw used" /> 사용 {formatDays(balance.used)}
        </span>
        <span>
          <i className="sw planned" /> 예정 {formatDays(balance.planned)}
        </span>
      </div>
    </div>
  );
}

function trimDays(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
