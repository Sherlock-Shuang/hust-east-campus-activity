import { useEffect, useState } from "react";

export const phoneQuery = "(max-width: 860px), (max-width: 1024px) and (max-height: 540px)";
export function usePhoneLayout() {
  const [phone, setPhone] = useState(() => window.matchMedia(phoneQuery).matches);
  useEffect(() => {
    const query = window.matchMedia(phoneQuery);
    const update = () => setPhone(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
}

export type MobileTab = "chats" | "contacts" | "discover" | "me";
export type IconName = "back" | "more" | "plus" | "smile" | "voice" | "chat" | "contacts" | "discover" | "me" | "favorite" | "clue" | "keyboard" | "location";
export function MobileIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    back: <path d="m15 4-8 8 8 8" />,
    more: <><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="20" cy="12" r="1" fill="currentColor"/></>,
    plus: <><circle cx="12" cy="12" r="10"/><path d="M12 6v12M6 12h12"/></>,
    smile: <><circle cx="12" cy="12" r="10"/><path d="M7 14c2 4 8 4 10 0"/><circle cx="8" cy="9" r=".7" fill="currentColor"/><circle cx="16" cy="9" r=".7" fill="currentColor"/></>,
    voice: <><circle cx="12" cy="12" r="10"/><path d="M9 10v4m3-6v8m3-10v12"/></>,
    chat: <><path d="M21 11.5c0 5-4.2 8-9 8-1.3 0-2.5-.2-3.7-.7L4 21l.8-4C3 15.7 2 13.6 2 11.5 2 6.8 6.5 3 12 3s9 3.8 9 8.5Z"/><circle cx="8" cy="11" r=".7" fill="currentColor"/><circle cx="16" cy="11" r=".7" fill="currentColor"/></>,
    contacts: <><circle cx="10" cy="8" r="4"/><path d="M2 21v-2c0-4 3-6 8-6s8 2 8 6v2M18 5a4 4 0 0 1 0 7m2 3c2 1 2 3 2 5"/></>,
    discover: <><circle cx="12" cy="12" r="10"/><path d="m16 8-2 6-6 2 2-6Z"/></>,
    me: <><circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/></>,
    favorite: <path d="m12 2 3 6.3 7 1-5 4.9 1.2 7-6.2-3.3-6.2 3.3 1.2-7-5-4.9 7-1Z"/>,
    clue: <><path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4"/></>,
    keyboard: <><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M5 9h1m3 0h1m3 0h1m3 0h1M5 12h1m3 0h1m3 0h1m3 0h1M7 16h10"/></>,
    location: <><path d="M19 10c0 5-7 12-7 12S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="9" r="2.5"/></>
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export const mobileTabs: { id: MobileTab; label: string; icon: IconName }[] = [
  { id: "chats", label: "微信", icon: "chat" },
  { id: "contacts", label: "通讯录", icon: "contacts" },
  { id: "discover", label: "发现", icon: "discover" },
  { id: "me", label: "我", icon: "me" }
];

export function MobileTabBar({ active, onChange, unread }: { active: MobileTab; onChange: (tab: MobileTab) => void; unread: boolean }) {
  return <nav className="wx-tabbar mobile-only" aria-label="微信导航">{mobileTabs.map(tab =>
    <button key={tab.id} type="button" aria-current={active === tab.id ? "page" : undefined} onClick={() => onChange(tab.id)}>
      <span className="wx-tab-icon"><MobileIcon name={tab.icon}/>{tab.id === "chats" && unread ? <i aria-label="有未读消息"/> : null}</span><span>{tab.label}</span>
    </button>
  )}</nav>;
}
