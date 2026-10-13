import { execSync } from "node:child_process"
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Shown in the footer as "Last updated": latest commit date, or today when there is no git history.
function lastUpdated() {
  try {
    const date = execSync("git log -1 --format=%cI", {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim()
    return date || new Date().toISOString()
  } catch {
    return new Date().toISOString()
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __LAST_UPDATED__: JSON.stringify(lastUpdated()) },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
