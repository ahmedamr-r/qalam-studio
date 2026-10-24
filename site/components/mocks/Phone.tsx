import { useId, type CSSProperties, type ReactNode } from "react";

import type { Locale } from "@/lib/i18n";

/* Tovi, a made-up money app. Its send-money screen is the one screen the whole page follows, so it
   is one component with switches for each scene: skeleton regions (Build), lint-broken values
   (Check), live tokens (Tokens), both languages at once for the in-place flip (Arabic), and the
   pushed "Sent" screen (Prototype). Everything visual reads the --t-* tokens set on the root. */

const COPY = {
  en: {
    time: "9:41",
    title: "Send money",
    youSend: "You send exactly",
    rate: "1 EUR = 1.0874 USD",
    theyGet: "Mariam gets",
    paying: "Paying with",
    balance: "EUR balance",
    change: "Change",
    arrives: "Arrives",
    today: "Today, in seconds",
    schedule: "Schedule",
    fees: "Total fees",
    shown: "Shown before you send",
    fee: "1.85 EUR",
    locked: "Rate locked for 30 minutes",
    cta: "Continue",
    transfer: "Transfer",
    sent: "Sent",
    sentTo: "Mariam gets",
    sentAmount: "271.85 USD",
    arrivesToday: "Arrives today, in seconds",
    reference: "Reference",
    done: "Done",
  },
  ar: {
    time: "9:41",
    title: "إرسال الأموال",
    youSend: "ترسل بالضبط",
    rate: "1 EUR = 1.0874 USD",
    theyGet: "تستلم مريم",
    paying: "الدفع من",
    balance: "رصيد اليورو",
    change: "تغيير",
    arrives: "الوصول",
    today: "اليوم، خلال ثوانٍ",
    schedule: "جدولة",
    fees: "إجمالي الرسوم",
    shown: "تظهر قبل الإرسال",
    fee: "1.85 يورو",
    locked: "السعر مثبّت لمدة 30 دقيقة",
    cta: "متابعة",
    transfer: "التحويل",
    sent: "تم الإرسال",
    sentTo: "تستلم مريم",
    sentAmount: "271.85 دولار",
    arrivesToday: "يصل اليوم، خلال ثوانٍ",
    reference: "المرجع",
    done: "تم",
  },
} as const;

type Key = keyof (typeof COPY)["en"];

export type PhoneProps = {
  lang: Locale;
  /** Render both languages; [data-lang] on the root shows one. Used by the in-place flip. */
  bilingual?: boolean;
  /** Grey placeholder blocks over each region, for the Build scene to clear. */
  skeleton?: boolean;
  /** Add the pushed "Sent" screen (Prototype scene). */
  withSent?: boolean;
  /** Only the "Sent" screen. */
  sentOnly?: boolean;
  /** Rounded device corners, for Present. Off: a canvas frame. */
  device?: boolean;
  style?: CSSProperties;
  className?: string;
  label?: string;
};

export function Phone({ lang, bilingual, skeleton, withSent, sentOnly, device, style, className, label }: PhoneProps) {
  const tx = (k: Key): ReactNode =>
    bilingual ? (
      <>
        <span data-l="en" lang="en">{COPY.en[k]}</span>
        <span data-l="ar" lang="ar">{COPY.ar[k]}</span>
      </>
    ) : (
      COPY[lang][k]
    );

  return (
    <div
      className={`phone ${device ? "phone-device" : ""} ${className ?? ""}`}
      data-phone=""
      data-lang={lang}
      dir={lang === "ar" ? "rtl" : "ltr"}
      lang={bilingual ? undefined : lang}
      style={style}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {!sentOnly && (
        <div className="ph-screen" data-screen="send">
          <StatusBar />
          <header className="ph-head" data-region="header">
            <span className="ph-close" data-flip="close" data-lint="close">
              <IconX />
            </span>
            <span className="ph-title" data-flip="title">
              {tx("title")}
            </span>
            <span className="ph-head-end" />
            {skeleton && <Skel rows={[["40%", 14]]} center />}
          </header>

          <section className="ph-amount" data-region="amount" data-flip="amount">
            <div className="ph-label" data-flip="l1">
              {tx("youSend")}
            </div>
            <div className="ph-row">
              <span className="ph-chip" data-flip="chip1">
                <FlagEU />
                EUR
                <IconChevronDown />
              </span>
              <span className="ph-num" data-flip="n1">
                250.00
              </span>
            </div>
            <div className="ph-rate" data-flip="rate">
              <span>
                {tx("rate")}
              </span>
            </div>
            <div className="ph-label" data-flip="l2">
              {tx("theyGet")}
            </div>
            <div className="ph-row">
              <span className="ph-chip" data-flip="chip2">
                <FlagUS />
                USD
                <IconChevronDown />
              </span>
              <span className="ph-num" data-flip="n2">
                271.85
              </span>
            </div>
            {skeleton && <Skel rows={[["34%", 10], ["100%", 34], ["50%", 10], ["100%", 34]]} />}
          </section>

          <section className="ph-details" data-region="details" data-flip="details">
            <Row icon={<IconWallet />} label={tx("paying")} value={tx("balance")} action={tx("change")} id="r1" />
            <Row icon={<IconBolt />} label={tx("arrives")} value={tx("today")} action={tx("schedule")} id="r2" />
            <Row
              icon={<IconReceipt />}
              label={tx("fees")}
              value={tx("shown")}
              action={
                <span className="ph-fee" data-flip="fee">
                  {tx("fee")}
                  <IconChevron />
                </span>
              }
              id="r3"
              fees
            />
            {skeleton && <Skel rows={[["60%", 12], ["80%", 12], ["70%", 12]]} gap={26} />}
          </section>

          <footer className="ph-foot" data-region="footer">
            <p className="ph-lock" data-flip="lock" data-lint="lock">
              <IconLock />
              <span>
                {tx("locked")}
              </span>
            </p>
            <span className="ph-cta" data-flip="cta" data-lint="cta">
              {tx("cta")}
            </span>
            {skeleton && <Skel rows={[["100%", 50]]} bottom />}
          </footer>
          <div className="ph-home" />
        </div>
      )}

      {(withSent || sentOnly) && (
        <div className="ph-screen ph-sent" data-screen="sent">
          <StatusBar />
          <header className="ph-head">
            <span className="ph-back">
              <IconChevron />
            </span>
            <span className="ph-title">
              {tx("transfer")}
            </span>
            <span className="ph-head-end" />
          </header>
          <div className="ph-sent-hero">
            <span className="ph-check">
              <IconCheck />
            </span>
            <span className="ph-sent-title">
              {tx("sent")}
            </span>
            <span className="ph-label">
              {tx("sentTo")}
            </span>
            <span className="ph-num ph-sent-num">
              {tx("sentAmount")}
            </span>
          </div>
          <section className="ph-details">
            <Row icon={<IconBolt />} label={tx("arrives")} value={tx("arrivesToday")} id="s1" />
            <Row icon={<IconReceipt />} label={tx("fees")} value={tx("fee")} id="s2" />
            <Row icon={<IconHash />} label={tx("reference")} value={<>TV-20481</>} id="s3" />
          </section>
          <footer className="ph-foot">
            <span className="ph-cta">
              {tx("done")}
            </span>
          </footer>
          <div className="ph-home" />
        </div>
      )}
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  action,
  id,
  fees,
}: {
  icon: ReactNode;
  label: ReactNode;
  value: ReactNode;
  action?: ReactNode;
  id: string;
  fees?: boolean;
}) {
  return (
    <div className="ph-item" data-flip={`row-${id}`} data-fees={fees || undefined}>
      <span className="ph-icon" data-flip={`icon-${id}`}>
        {icon}
      </span>
      <span className="ph-text" data-flip={`text-${id}`}>
        <span className="ph-item-label">{label}</span>
        <span className="ph-item-value">{value}</span>
      </span>
      {action && (
        <span className="ph-action" data-flip={`action-${id}`}>
          {action}
        </span>
      )}
    </div>
  );
}

function Skel({
  rows,
  gap = 12,
  center,
  bottom,
}: {
  rows: [string, number][];
  gap?: number;
  center?: boolean;
  bottom?: boolean;
}) {
  return (
    <div className="ph-skel" data-skel="" style={{ gap, alignItems: center ? "center" : undefined, justifyContent: bottom ? "flex-end" : undefined }}>
      {rows.map(([w, h], i) => (
        <i key={i} style={{ width: w, height: h }} />
      ))}
    </div>
  );
}

function StatusBar() {
  return (
    <div className="ph-status" dir="ltr">
      <span>9:41</span>
      <span className="ph-status-icons">
        <svg width="17" height="11" viewBox="0 0 17 11" aria-hidden>
          <rect x="0" y="7" width="3" height="4" rx="1" fill="currentColor" />
          <rect x="4.5" y="5" width="3" height="6" rx="1" fill="currentColor" />
          <rect x="9" y="2.5" width="3" height="8.5" rx="1" fill="currentColor" />
          <rect x="13.5" y="0" width="3" height="11" rx="1" fill="currentColor" />
        </svg>
        <svg width="15" height="11" viewBox="0 0 15 11" aria-hidden>
          <path d="M7.5 2.2c2.1 0 4 .8 5.4 2.1l1.1-1.1A9.2 9.2 0 0 0 7.5.6 9.2 9.2 0 0 0 1 3.2l1.1 1.1A7.6 7.6 0 0 1 7.5 2.2Zm0 3.2c1.2 0 2.3.5 3.1 1.2l1.1-1.1a6 6 0 0 0-8.4 0l1.1 1.1c.8-.7 1.9-1.2 3.1-1.2Zm0 3.2c-.4 0-.8.2-1.1.5L7.5 10.2l1.1-1.1c-.3-.3-.7-.5-1.1-.5Z" fill="currentColor" />
        </svg>
        <svg width="25" height="12" viewBox="0 0 25 12" aria-hidden>
          <rect x=".5" y=".5" width="21" height="11" rx="3.5" fill="none" stroke="currentColor" opacity=".4" />
          <rect x="2" y="2" width="18" height="8" rx="2" fill="currentColor" />
          <path d="M23 4v4c.8-.3 1.4-1.1 1.4-2S23.8 4.3 23 4Z" fill="currentColor" opacity=".45" />
        </svg>
      </span>
    </div>
  );
}

/* Icons: 1.6px strokes on a 20px grid. `dir-icon` marks the ones that point, which mirror in RTL. */
const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const IconX = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
    <path d="M5 5l10 10M15 5 5 15" {...S} />
  </svg>
);
const IconChevron = () => (
  <svg className="dir-icon" width="14" height="14" viewBox="0 0 20 20" aria-hidden>
    <path d="m8 4.5 5.5 5.5L8 15.5" {...S} strokeWidth={2} />
  </svg>
);
const IconChevronDown = () => (
  <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden>
    <path d="m4.5 8 5.5 5.5L15.5 8" {...S} strokeWidth={2.2} />
  </svg>
);
const IconWallet = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
    <rect x="2.5" y="4.5" width="15" height="11" rx="2.2" {...S} />
    <path d="M2.5 8h15" {...S} />
    <path d="M13 12h1.5" {...S} />
  </svg>
);
const IconBolt = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
    <path d="M11 2.5 4.5 11H10l-1 6.5L15.5 9H10l1-6.5Z" {...S} />
  </svg>
);
const IconReceipt = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
    <path d="M5 2.5h10v15l-2-1.3-1.7 1.3-1.3-1.3-1.3 1.3L7 16.2l-2 1.3v-15Z" {...S} />
    <path d="M7.5 7h5M7.5 10h5" {...S} />
  </svg>
);
const IconHash = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
    <path d="M8 3 6.5 17M13.5 3 12 17M3.5 7.5h14M3 12.5h14" {...S} />
  </svg>
);
const IconLock = () => (
  <svg width="13" height="13" viewBox="0 0 20 20" aria-hidden>
    <rect x="4" y="9" width="12" height="8.5" rx="2" {...S} strokeWidth={1.8} />
    <path d="M6.8 9V6.5a3.2 3.2 0 0 1 6.4 0V9" {...S} strokeWidth={1.8} />
  </svg>
);
const IconCheck = () => (
  <svg width="28" height="28" viewBox="0 0 20 20" aria-hidden>
    <path d="m5 10.5 3.2 3.2L15 7" {...S} strokeWidth={2.2} />
  </svg>
);
const FlagEU = () => (
  <svg className="ph-flag" width="20" height="20" viewBox="0 0 20 20" aria-hidden>
    <circle cx="10" cy="10" r="10" fill="#2a4bb0" />
    {Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return <circle key={i} cx={10 + Math.cos(a) * 5.6} cy={10 + Math.sin(a) * 5.6} r="0.95" fill="#f7c843" />;
    })}
  </svg>
);
function FlagUS() {
  const id = "us" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
  <svg className="ph-flag" width="20" height="20" viewBox="0 0 20 20" aria-hidden>
    <defs>
      <clipPath id={id}>
        <circle cx="10" cy="10" r="10" />
      </clipPath>
    </defs>
    <g clipPath={`url(#${id})`}>
      <rect width="20" height="20" fill="#fff" />
      {[0, 3, 6, 9, 12, 15, 18].map((y) => (
        <rect key={y} y={y} width="20" height="1.5" fill="#c8372d" />
      ))}
      <rect width="10" height="10.5" fill="#2b3b8f" />
    </g>
  </svg>
  );
}
