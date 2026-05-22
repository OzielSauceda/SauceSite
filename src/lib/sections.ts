export const PINK = "#ec4899";
export const CYAN = "#22d3ee";
export const YELLOW = "#ffd131";
export const VIOLET = "#a78bfa";

export type Section = {
  id: string;
  label: string;
  accent: string;
};

export const SECTIONS: Section[] = [
  { id: "about", label: "About", accent: PINK },
  { id: "projects", label: "Projects", accent: CYAN },
  { id: "research", label: "Research", accent: YELLOW },
  { id: "contact", label: "Contact", accent: VIOLET },
];

