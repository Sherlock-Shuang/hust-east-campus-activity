import { useEffect, useRef, useState } from "react";
import "./she-love-project.css";

const repositoryUrl = "https://github.com/863401402/she-love-me";
export const sheLoveAiInstruction = `请帮我在电脑上的 AI 编程助手环境中安装并使用「她不一样 · 恋情分析室」Agent Skill：
${repositoryUrl}

先阅读仓库 README、SKILL.md 和环境要求，检查当前工具与运行环境，再按项目说明安装和分析。
我会自行提供已经导出、符合项目支持格式的 JSON 或 Markdown 聊天记录；请先核对文件格式，再确认分析范围。
不要自动读取微信、QQ、通讯录或其他应用，不要自动登录或抓取聊天记录。
分析时请区分聊天记录中的事实与推测，并说明数据不足之处。`;

export function SheLoveProject({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  async function copyInstruction() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(sheLoveAiInstruction);
      setCopyStatus("已复制，可以粘贴给电脑上的 AI 编程助手。");
    } catch {
      instructionRef.current?.focus({ preventScroll: true });
      instructionRef.current?.select();
      setCopyStatus("已选中下方指令，请长按或使用复制快捷键复制。");
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="she-love-project"
      aria-labelledby="she-love-title"
      aria-describedby="she-love-description"
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      }}
    >
      <header className="she-love-header">
        <button ref={closeRef} className="she-love-back" type="button" onClick={onClose} aria-label="返回聊天">‹ 返回聊天</button>
        <span>通关后解锁</span>
      </header>
      <div className="she-love-content">
        <div className="she-love-mark" aria-hidden="true">她</div>
        <h1 id="she-love-title">她不一样</h1>
        <p className="she-love-subtitle">恋情分析室</p>
        <p id="she-love-description">用已导出的聊天记录整理沟通数据，再交给你使用的 AI 工具分析。</p>
        <section className="she-love-guide" aria-labelledby="she-love-guide-title">
          <h2 id="she-love-guide-title">在电脑上使用</h2>
          <p>这是一个开源 Agent Skill，运行在电脑上的 AI 编程助手中。此页提供项目介绍和使用指令，没有上传或分析聊天记录的功能，也不收集聊天数据。</p>
          <ol>
            <li>打开开源项目，了解安装和使用方式。</li>
            <li>将下方指令复制给你的 AI 编程助手。</li>
            <li>按项目支持的格式，自行提供已导出的 JSON 或 Markdown 聊天记录。</li>
          </ol>
        </section>
        <div className="she-love-actions">
          <a className="she-love-primary" href={repositoryUrl} target="_blank" rel="noopener noreferrer">查看开源项目 ↗</a>
          <button className="she-love-copy" type="button" onClick={() => void copyInstruction()}>复制给 AI 的指令</button>
        </div>
        <label className="she-love-instruction-label" htmlFor="she-love-instruction">给 AI 的指令</label>
        <textarea ref={instructionRef} id="she-love-instruction" readOnly value={sheLoveAiInstruction} rows={10} spellCheck={false}/>
        <p className="she-love-copy-status" role="status" aria-live="polite">{copyStatus || "也可以直接在文本框内选择并复制。"}</p>
        <footer className="she-love-credits">
          <span>开源作者：<a href={repositoryUrl} target="_blank" rel="noopener noreferrer">863401402 / she-love-me</a></span>
          <a href={`${repositoryUrl}/blob/HEAD/LICENSE`} target="_blank" rel="noopener noreferrer">MIT License ↗</a>
        </footer>
      </div>
    </dialog>
  );
}
