declare module '*.css' {
  const sheet: CSSStyleSheet;
  export default sheet;
}

declare module '*.html?raw' {
  const content: string;
  export default content;
}

