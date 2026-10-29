import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../app/store/useAppStore";
import { truthLines } from "../../features/story/stageConfig";

export function TruthPage() {
  const navigate = useNavigate();
  const enterTruthReveal = useAppStore((state) => state.enterTruthReveal);
  const completeTruth = useAppStore((state) => state.completeTruth);
  const finishWakeUp = useAppStore((state) => state.finishWakeUp);
  const [visibleCount, setVisibleCount] = useState(1);

  useEffect(() => {
    enterTruthReveal();
  }, [enterTruthReveal]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setVisibleCount((current) => {
        if (current >= truthLines.length) {
          window.clearInterval(timer);
          return current;
        }

        return current + 1;
      });
    }, 1100);

    return () => window.clearInterval(timer);
  }, []);

  const completed = visibleCount >= truthLines.length;

  return (
    <main className="screen final-transition-screen">
      <section className="shell page page-body stack truth-stage truth-stage-entry">
        {truthLines.slice(0, visibleCount).map((line) => (
          <p key={line} className="truth-line">
            {line}
          </p>
        ))}
        <div className="spacer" />
        {completed ? (
          <button
            className="button-primary"
            onClick={() => {
              completeTruth();
              finishWakeUp();
              navigate("/chat", { replace: true });
            }}
          >
            梦醒
          </button>
        ) : null}
      </section>
    </main>
  );
}
