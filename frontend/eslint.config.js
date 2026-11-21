import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import react from "eslint-plugin-react";

export default [
  // test/ 跑在 Node 下（node --test），用 Node 全局；不套浏览器的 globals 规则。
  { ignores: ["dist", "node_modules", "test/**"] },
  {
    files: ["test/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        globalThis: "readonly",
        queueMicrotask: "readonly",
        setTimeout: "readonly",
        console: "readonly",
      },
    },
  },
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx}", "vite.config.js", "vitest.config.js", "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        indexedDB: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        DataTransfer: "readonly",
        Blob: "readonly",
        File: "readonly",
        FileReader: "readonly",
        ArrayBuffer: "readonly",
        Uint8Array: "readonly",
        DataView: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        DOMParser: "readonly",
        Buffer: "readonly",
        URLSearchParams: "readonly",
        AbortController: "readonly",
        CustomEvent: "readonly",
        Event: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        process: "readonly",
        location: "readonly",
        history: "readonly",
        URL: "readonly",
        NodeJS: "readonly",
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/no-unescaped-entities": "off",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^React$" }],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
  },
];
