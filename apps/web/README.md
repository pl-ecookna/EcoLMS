# Web

Фронтенд EcoLMS на Next.js App Router.

## Актуальный стек

- Next.js `16.2.2`
- React `19.2.4`
- TypeScript `5`
- Tailwind CSS `4`
- shadcn/ui
- `lucide-react`
- `react-markdown` + `remark-gfm`

## Что реализовано

- список проектов с пагинацией;
- создание проекта;
- загрузка исходных файлов;
- просмотр статусов проекта и этапов;
- просмотр history задач и health-состояния сервисов;
- запуск генерации этапов;
- редактирование Markdown-артефактов;
- скачивание итоговых артефактов.

## Важные технические детали

- Корневой экран: [apps/web/src/components/ecolms-dashboard.tsx](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/apps/web/src/components/ecolms-dashboard.tsx)
- Страница приложения: [apps/web/src/app/page.tsx](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/apps/web/src/app/page.tsx)
- Клиент API: [apps/web/src/lib/ecolms-api.ts](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/apps/web/src/lib/ecolms-api.ts)
- Внутренний proxy для backend-запросов: [apps/web/src/app/api/[...path]/route.ts](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/apps/web/src/app/api/[...path]/route.ts)
- Proxy для `PUT` загрузки частей файла в S3: [apps/web/src/app/api/s3-upload/route.ts](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/apps/web/src/app/api/s3-upload/route.ts)

## Запуск

- `pnpm dev`
- `pnpm build`
- `pnpm start`
- `pnpm lint`

По умолчанию frontend ожидает backend через `ECOLMS_API_BASE_URL`.
