import { useEffect, useState } from "react";

type Slide = {
  kind: "title" | "content" | "cta";
  tag?: string;
  title: string;
  body?: string;
  bullets?: { k: string; v: string }[];
  footnote?: string;
};

const SLIDES: Slide[] = [
  {
    kind: "title",
    title: "pDDI",
    body: "Protocol Drama Data Index",
    footnote: "Bet on which DeFi protocols are dying.",
  },
  {
    kind: "content",
    tag: "01 · Problem",
    title: "You can’t bet on a protocol dying.",
    body: "You think a project is in trouble. But it has no token, so you can’t short it. All you can do is tweet.",
    bullets: [
      { k: "Remember FTX?", v: "No token. No way to short it. Everyone saw it — no one could act." },
      { k: "No tool exists", v: "Exchanges, bridges, risk managers have no token to bet against." },
      { k: "Talk is cheap", v: "Being right earns you nothing today." },
    ],
  },
  {
    kind: "content",
    tag: "02 · Solution",
    title: "pDDI lets you trade your opinion.",
    body: "Each protocol gets a Drama Score from 0 to 100 — higher means more trouble. Buy HODL if you think it survives, RIP if you think it’s cooked.",
    bullets: [
      { k: "A real price", v: "Shares trade from 0 to 100¢. The price is the odds." },
      { k: "Leave whenever", v: "Score moves your way? Sell and take profit — no waiting." },
      { k: "No token needed", v: "Works for exchanges and bridges — anything with data." },
    ],
  },
  {
    kind: "content",
    tag: "03 · Why Monad",
    title: "Fast enough for a crisis.",
    bullets: [
      { k: "0.4s blocks", v: "Your trade confirms right away." },
      { k: "10,000 TPS", v: "Handles a rush of trades when a protocol is melting down." },
      { k: "Not Ethereum", v: "Too slow and too pricey exactly when you need it." },
    ],
  },
  {
    kind: "content",
    tag: "04 · Business",
    title: "How it makes money — and what it becomes.",
    bullets: [
      { k: "2% fee", v: "On every trade." },
      { k: "A fear gauge for DeFi", v: "Add up all markets and you get a live risk index." },
      { k: "People pay for it", v: "Funds pay for the signal. Protocols pay to watch their own score." },
    ],
  },
  {
    kind: "content",
    tag: "05 · Team",
    title: "Alex — the builder behind pDDI.",
    body: "8 years building DeFi: lending, yield vaults, account abstraction. Before this — Clearpool, Protofire, Partitura.",
    bullets: [
      { k: "Open to", v: "Co-founder, smart contract dev, or research role." },
      { k: "Looking for", v: "A team that ships." },
    ],
  },
  {
    kind: "cta",
    title: "Bet on the cooked.",
    body: "Monad Testnet · chainId 10143",
    footnote: "Press Enter to open the app.",
  },
];

export function Pitch({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const last = SLIDES.length - 1;

  const next = () => setI((v) => (v >= last ? v : v + 1));
  const prev = () => setI((v) => (v <= 0 ? v : v - 1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "Escape") onClose();
      else if (e.key === "Enter") {
        if (i === last) onClose();
        else next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, last, onClose]);

  const s = SLIDES[i];

  return (
    <div className="pitch">
      <button className="pitch-skip" onClick={onClose}>
        Skip intro &rarr;
      </button>

      <div className={`slide slide-${s.kind}`} key={i}>
        {s.tag && <span className="slide-tag">{s.tag}</span>}

        {s.kind === "title" ? (
          <>
            <h1 className="slide-logo">
              <span className="logo-emoji">📉</span> {s.title}
            </h1>
            <p className="slide-sub">{s.body}</p>
            {s.footnote && <p className="slide-foot">{s.footnote}</p>}
          </>
        ) : s.kind === "cta" ? (
          <>
            <h1 className="slide-title big">{s.title}</h1>
            <p className="slide-sub">{s.body}</p>
            <button className="pitch-enter" onClick={onClose}>
              Enter pDDI &rarr;
            </button>
            {s.footnote && <p className="slide-foot">{s.footnote}</p>}
          </>
        ) : (
          <>
            <h1 className="slide-title">{s.title}</h1>
            {s.body && <p className="slide-body">{s.body}</p>}
            {s.bullets && (
              <ul className="slide-bullets">
                {s.bullets.map((b) => (
                  <li key={b.k}>
                    <strong>{b.k}</strong>
                    <span>{b.v}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="pitch-nav">
        <button className="navbtn" onClick={prev} disabled={i === 0} aria-label="Previous">
          &larr;
        </button>
        <div className="dots">
          {SLIDES.map((_, idx) => (
            <button
              key={idx}
              className={idx === i ? "dot active" : "dot"}
              onClick={() => setI(idx)}
              aria-label={`Slide ${idx + 1}`}
            />
          ))}
        </div>
        <button
          className="navbtn"
          onClick={i === last ? onClose : next}
          aria-label="Next"
        >
          &rarr;
        </button>
      </div>
    </div>
  );
}
