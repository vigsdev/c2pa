# Provenance

Check whether a file has C2PA Content Credentials, and what they say.

**Use it:** [labs.vigs.dev/provenance](https://labs.vigs.dev/provenance)

[Content Credentials](https://c2pa.org/) (C2PA) are signed records some apps attach to a file: what made it, who signed it, what it was made from and whether AI was involved. Drop in a photo, video, audio file or PDF and Provenance shows you:

- **Whether it has credentials**, and whether they check out.
- **What made it**, such as Photoshop, After Effects or Premiere Pro.
- **Who signed it.**
- **What it was made from**, as a tree of the files that went into it.
- **AI involvement**, when the credentials say the file or a part of it was AI-generated.

It runs in your browser. The file never leaves your computer: no uploads, no server, no account.

## Good to know

- **No credentials doesn't mean fake.** Most files don't have any, and many websites and apps strip them when a file is uploaded or exported.
- **Credentials show where a file came from, not whether it's true.** They tell you who signed it and with what tool.

## Run it locally

```bash
npm install
npm run dev
```

Built with React, TypeScript, Vite, Tailwind and the Content Authenticity Initiative's [c2pa-web](https://github.com/contentauth/c2pa-js).

---

Part of [Lab](https://labs.vigs.dev), small tools by [Vigs](https://vigs.dev).
