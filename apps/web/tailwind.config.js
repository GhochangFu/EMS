/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bms: {
          green: "#00A651",
          "green-light": "#3DCD58",
          "green-dark": "#007C3C",
          header: "#1D2430",
          canvas: "#F2F4F7",
          ink: "#1A2230",
          muted: "#4A5464",
        },
      },
      fontFamily: {
        sans: [
          '"IBM Plex Sans"',
          "system-ui",
          "sans-serif",
        ],
        condensed: [
          '"IBM Plex Sans Condensed"',
          '"IBM Plex Sans"',
          "system-ui",
          "sans-serif",
        ],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
