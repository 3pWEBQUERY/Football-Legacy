"use client";
/**
 * Englische Fassung: übersetzt die gerenderte Oberfläche aus dem Katalog
 * (@fl/i18n/en). Der Quelltext bleibt deutsch; React schreibt deutsche Texte,
 * dieser Beobachter ersetzt sie nach dem Hydrieren durch die Übersetzung.
 * Deutsche Spieler laden den Katalog nicht.
 *
 * Elemente mit translate="no" (z. B. Chat-Nachrichten) bleiben unverändert;
 * mehrdeutige Kürzel geben ihre Übersetzung ausdrücklich mit (data-en="W").
 */
import { useEffect } from "react";
import type { Translator } from "@fl/i18n";
import { currentLang } from "@/lib/client/lang";

const ATTRS = ["title", "placeholder", "aria-label", "alt"];
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "CODE", "NOSCRIPT", "svg"]);

export function LangRuntime() {
  useEffect(() => {
    if (currentLang() !== "en") return;
    let stop = () => {};
    import("@fl/i18n/en").then(({ en }) => {
      stop = start(en);
      document.documentElement.classList.remove("i18n-pending");
    }).catch(() => document.documentElement.classList.remove("i18n-pending"));
    return () => stop();
  }, []);
  return null;
}

function start(tr: Translator) {
  /** Deutscher Originaltext je Textknoten und der zuletzt von uns gesetzte Wert */
  const original = new WeakMap<Text, string>();
  const written = new WeakMap<Text, string>();
  const writtenAttr = new WeakMap<Element, Map<string, string>>();

  const skipped = (el: Element | null) => {
    for (let e = el; e; e = e.parentElement) {
      if (SKIP_TAGS.has(e.tagName) || e.getAttribute("translate") === "no" || (e as HTMLElement).isContentEditable) return true;
    }
    return false;
  };
  const source = (t: Text) => {
    const v = t.nodeValue ?? "";
    if (written.get(t) === v) return original.get(t) ?? v;
    original.set(t, v);
    return v;
  };
  const write = (t: Text, v: string) => {
    written.set(t, v);
    if (t.nodeValue !== v) t.nodeValue = v;
  };

  /** Direkte Textkinder eines Elements: reiner Text als Ganzes, sonst Stück für Stück */
  function texts(el: Element) {
    const nodes: Text[] = [];
    let mixed = false;
    for (const c of el.childNodes) {
      if (c.nodeType === Node.TEXT_NODE) nodes.push(c as Text);
      else if (c.nodeType === Node.ELEMENT_NODE) mixed = true;
    }
    if (!nodes.length) return;
    const src = nodes.map(source);
    const fixed = el.getAttribute("data-en");
    if (fixed !== null) {
      write(nodes[0], fixed);
      for (const n of nodes.slice(1)) write(n, "");
      return;
    }
    if (!mixed && nodes.length > 1) {
      const whole = tr.lookup(src.join(""));
      if (whole !== null) {
        write(nodes[0], whole);
        for (const n of nodes.slice(1)) write(n, "");
        return;
      }
    }
    nodes.forEach((n, i) => write(n, tr(src[i])));
  }

  function attrs(el: Element) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (!v) continue;
      const mine = writtenAttr.get(el);
      if (mine?.get(a) === v) continue;
      const t = tr(v);
      if (t === v) continue;
      (mine ?? writtenAttr.set(el, new Map()).get(el)!).set(a, t);
      el.setAttribute(a, t);
    }
  }

  function element(el: Element) {
    if (skipped(el)) return;
    texts(el);
    attrs(el);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => {
        const e = n as Element;
        if (e.getAttribute("translate") === "no") return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(e.tagName)) {
          if (e.tagName === "svg") attrs(e); // Diagramme: Beschriftung ja, Inhalt nein
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      texts(n as Element);
      attrs(n as Element);
    }
  }

  const title = () => {
    const t = tr(document.title);
    if (t !== document.title) document.title = t;
  };

  element(document.body);
  title();
  const obs = new MutationObserver((records) => {
    const parents = new Set<Element>();
    for (const r of records) {
      if (r.type === "characterData") {
        const t = r.target as Text;
        if (written.get(t) !== t.nodeValue && t.parentElement) parents.add(t.parentElement);
      } else if (r.type === "attributes") {
        if (skipped(r.target as Element)) continue;
        if (r.attributeName === "data-en") texts(r.target as Element);
        else attrs(r.target as Element);
      } else {
        if (r.target.nodeType === Node.ELEMENT_NODE) parents.add(r.target as Element);
        for (const n of r.addedNodes) if (n.nodeType === Node.ELEMENT_NODE) parents.add(n as Element);
      }
    }
    for (const p of parents) {
      if (!p.isConnected || skipped(p)) continue;
      if (p.tagName === "TITLE") title();
      else element(p);
    }
  });
  obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS, "data-en"] });
  const head = document.querySelector("title");
  if (head) obs.observe(head, { childList: true, characterData: true, subtree: true });
  return () => obs.disconnect();
}
