# Pembaca Website & GitHub

Workbench untuk membaca website dari repository ZIP dan menghubungkan elemen UI yang diklik ke file source GitHub.

## Fitur MVP

- Upload ZIP repository Next.js/React.
- Jalankan repository di browser memakai WebContainer.
- Inject `data-github-source` pada permukaan JSX.
- Tahan Alt lalu klik elemen di preview untuk menangkap source path.
- Tampilkan kandidat source, confidence, evidence, dan deep link GitHub.

## Development

```bash
npm run dev
npm run lint
npm run typecheck
npm run build
npm run test:e2e
```

## Catatan Keamanan

Prototype ini ditujukan untuk repository milik sendiri. Jangan jadikan production source maps sebagai default publik; gunakan repository lokal, metadata dev, AST/source instrumentation, dan koreksi manual sebagai fondasi mapping.
