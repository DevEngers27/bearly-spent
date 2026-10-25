import { useEffect, useRef, useState } from "react";

export const MONEY_SECTIONS = [["allowance", "Allowance"], ["goals", "Goals & tasks"], ["activity", "Transactions"]];
export const KIDS_SECTIONS = [["children", "Children"], ["settings", "Friends & privacy"]];
export const MORE_SECTIONS = [["guardian", "Guardian log"], ["buddy", "Buddy chats"], ["account", "Account"], ["security", "Security"]];
export const PARENT_TABS = [["inbox", "Inbox", "envelope"], ["overview", "Home", "home"], ["money", "Money", "wallet"], ["kids", "Kids", "paws"], ["more", "More", "more"]];

const contains = (sections, id) => sections.some(([key]) => key === id);
const store = {
  get: (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
  set: (key, value) => { try { localStorage.setItem(key, value); } catch {} },
};

export function useParentNavigation() {
  const [mobile, setMobile] = useState(() => Boolean(window.matchMedia?.("(max-width: 820px)").matches));
  const [sec, setSec] = useState("inbox");
  const [opened, setOpened] = useState(["inbox"]);
  const [moneySection, setMoneySection] = useState(() => {
    const saved = store.get("mq_parent_money", "allowance");
    return contains(MONEY_SECTIONS, saved) ? saved : "allowance";
  });
  const [kidsSection, setKidsSection] = useState("children");
  const marker = useRef(`parent-${Date.now()}-${Math.random()}`);
  const current = useRef(sec);
  current.current = sec;
  const skipPop = useRef(false);
  const backPending = useRef(false);
  const pendingPush = useRef(null);
  const ownsEntry = () => history.state?.mqParent?.owner === marker.current;
  const rememberOpened = (id) => setOpened((previous) => previous.includes(id) ? previous : [...previous, id]);
  const pushDetail = (id) => {
    const entry = { ...history.state, mqParent: { owner: marker.current, section: id } };
    if (ownsEntry()) history.replaceState(entry, "");
    else history.pushState(entry, "");
  };

  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 820px)");
    if (!query) return;
    const change = () => {
      setMobile(query.matches);
      if (!query.matches && current.current === "more") setSec("inbox");
    };
    change();
    if (query.addEventListener) query.addEventListener("change", change);
    else query.addListener?.(change);
    return () => {
      if (query.removeEventListener) query.removeEventListener("change", change);
      else query.removeListener?.(change);
    };
  }, []);

  useEffect(() => {
    if (!mobile) return;
    backPending.current = false;
    // A desktop detail also gets a Back destination when the window narrows.
    if (contains(MORE_SECTIONS, current.current) && !ownsEntry()) {
      history.pushState({ ...history.state, mqParent: { owner: marker.current, section: current.current } }, "");
    }
    const back = () => {
      backPending.current = false;
      if (pendingPush.current) {
        pushDetail(pendingPush.current);
        pendingPush.current = null;
        skipPop.current = false;
        return;
      }
      if (skipPop.current) { skipPop.current = false; return; }
      const next = ownsEntry() ? history.state.mqParent.section : "more";
      if (ownsEntry() || contains(MORE_SECTIONS, current.current)) {
        setSec(next);
        rememberOpened(next);
      }
    };
    window.addEventListener("popstate", back);
    return () => {
      window.removeEventListener("popstate", back);
      skipPop.current = false;
      pendingPush.current = null;
      if (ownsEntry() && !backPending.current) history.back();
    };
  }, [mobile]);

  const selectSection = (id) => {
    if (contains(MONEY_SECTIONS, id)) { setMoneySection(id); store.set("mq_parent_money", id); }
    if (contains(KIDS_SECTIONS, id)) setKidsSection(id);
    if (mobile && contains(MORE_SECTIONS, id)) {
      if (backPending.current) pendingPush.current = id;
      else pushDetail(id);
    } else if (mobile && ownsEntry()) {
      // Consume the detail entry without letting its popstate undo a tab tap.
      skipPop.current = true;
      pendingPush.current = null;
      if (!backPending.current) { backPending.current = true; history.back(); }
    }
    setSec(id);
    rememberOpened(id);
  };
  const tab = contains(MONEY_SECTIONS, sec) ? "money" : contains(KIDS_SECTIONS, sec) ? "kids" : contains(MORE_SECTIONS, sec) ? "more" : sec;
  const selectTab = (id) => selectSection(id === "money" ? moneySection : id === "kids" ? kidsSection : id);
  const backToMore = () => selectSection("more");
  return { mobile, sec, opened, tab, selectSection, selectTab, backToMore };
}
