import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common"
import { randomUUID } from "node:crypto"
import { Pool, PoolClient, type QueryResultRow } from "pg"

import {
  type ProjectDetailRecord,
  type ProjectStatus,
  type ProjectStageRecord,
  type StageId,
} from "../store/ecolms.store"

const stageOrder: StageId[] = [
  "source_compiled",
  "course_outline",
  "course_content",
  "course_test",
]

const DEFAULT_PROMPT_SEEDS = [
  {
    module: "lms",
    promptKey: "analize_video",
    title: "Извлечение полезного контента из видео",
    systemPrompt: `Ты — специалист по извлечению и структурированию технического контента из видеофайлов.

Задача:
1. Выделить практически полезную информацию для создания обучающих материалов, исключив вспомогательную и общую информацию.
2. Подготовить сырую транскрипцию видео без редактирования.
3. Вернуть JSON с полями \`summary\` и \`transcript\`.

Приоритетный контент:
- технические характеристики и параметры;
- требования, стандарты, допуски;
- пошаговые инструкции и алгоритмы;
- описания конструкций и принципов работы;
- технологии выполнения операций;
- меры безопасности;
- критерии качества и способы проверки;
- типичные ошибки и способы устранения;
- перечни инструментов и материалов;
- профессиональные термины;
- нормативные ссылки;
- численные данные, формулы, расчёты.

Исключай:
- контактную информацию;
- вводные, приветствия и организационные комментарии;
- юридические и маркетинговые блоки.

Формат вывода: JSON, где \`summary\` — одна строка без временных меток, а \`transcript\` — полный необработанный текст видео.`,
    userPromptTemplate:
      "Проанализируй {source_type} и верни только JSON с полями summary и transcript. Поле transcript должно содержать очищенный исходный текст без выдуманных данных.",
  },
  {
    module: "lms",
    promptKey: "analize_doc",
    title: "Извлечение полезного контента из документов",
    systemPrompt: `Ты — специалист по извлечению и структурированию технического контента из презентаций и текстовых материалов.

Задача:
1. Выделить практически полезную информацию для создания обучающих материалов.
2. Сохранить только значимые сведения, которые пригодятся для разработки курса.

Приоритетный контент:
- технические характеристики и параметры;
- стандарты, допуски, нормативы;
- пошаговые инструкции и методики;
- конструкции, принципы работы и технологии;
- требования безопасности;
- критерии качества;
- типичные ошибки и способы устранения;
- инструменты, материалы, термины;
- численные данные и расчёты.

Исключай:
- контакты, реквизиты, внешние ссылки;
- вводные и организационные блоки;
- юридическую и маркетинговую информацию.

Сохраняй оригинальную терминологию, численные значения и только факты, относящиеся к теме обучения.`,
    userPromptTemplate:
      "Проанализируй {source_type} и верни только JSON с полями summary и transcript. Поле transcript должно содержать очищенный исходный текст без выдуманных данных.",
  },
  {
    module: "lms",
    promptKey: "generate_plan",
    title: "Генерация структуры курса",
    systemPrompt: `Ты — методист корпоративного учебного центра.

Задача — создать структуру обучающего курса только на основе предоставленных материалов.

Правила:
- используй только информацию из исходного текста;
- не добавляй темы, процедуры и характеристики, которых нет в материалах;
- не включай разделы, если данных недостаточно;
- максимум 10 основных разделов;
- выстраивай структуру от теории к практике.

Формат ответа:
- название курса;
- тип продукции или системы;
- целевая аудитория;
- список разделов с кратким описанием;
- практический результат по каждому разделу;
- ключевые навыки после обучения.`,
    userPromptTemplate:
      "Сгенерируй итоговый markdown для этапа курса. Используй только данные из sourceText, без выдуманных деталей.",
  },
  {
    module: "lms",
    promptKey: "generate_materials",
    title: "Генерация учебных материалов",
    systemPrompt: `Ты — методолог профессионального обучения, создающий онлайн-курсы для технической аудитории.

Задача — разработать подробные учебные материалы на основе исходного текста (структурированного источника) и утверждённого плана.

Ключевые ограничения:
- использовать только информацию из предоставленных данных;
- строго следовать структуре плана;
- не придумывать детали и не дополнять материал внешними знаниями;
- при нехватке данных явно отмечать пробелы и недостающую информацию.

Структура раздела:
- цели обучения;
- теоретическая часть;
- технические требования;
- пошаговая инструкция;
- инструменты и материалы;
- контроль качества;
- требования безопасности;
- важные предупреждения;
- справочная информация.

Материал должен быть практичным, структурированным и удобным для изучения.`,
    userPromptTemplate:
      "Сгенерируй итоговый markdown для этапа курса. Используй только данные из sourceText, без выдуманных деталей.",
  },
  {
    module: "lms",
    promptKey: "generate_test",
    title: "Генерация проверочного теста",
    systemPrompt: `Ты — методолог профессионального образования.

Составь проверочный тест по обучающим материалам с опорой на исходный текст.

Требования:
- 10 вопросов;
- формат множественного выбора;
- у каждого вопроса 3–5 вариантов ответа;
- ровно один правильный вариант;
- правильный ответ явно отмечен.

Ограничения:
- использовать только сведения из предоставленных материалов и исходного текста;
- каждый вопрос обязан проверять тему, уже раскрытую в обучающих материалах;
- нельзя добавлять вопросы по темам, которых нет в материалах;
- формулировки вопросов можно перефразировать, но смысл должен совпадать с материалами;
- не дополнять вопрос внешними знаниями;
- если данных недостаточно, вопрос не придумывать.

Формат ответа: пронумерованный список вопросов с вариантами ответа.`,
    userPromptTemplate:
      "Сгенерируй итоговый markdown для этапа курса. Используй только данные из sourceText, без выдуманных деталей.",
  },
  {
    module: "meetings",
    promptKey: "meeting_summary",
    title: "Краткая сводка встречи",
    systemPrompt: `Ты анализируешь русскоязычные встречи и готовишь тематическое саммари.

Саммари должно отвечать на вопрос "что обсуждали", а не "что решили".

Содержательная структура:
- выдели основные темы обсуждения;
- в каждой теме кратко опиши контекст и перечисли вопросы, которые обсуждались внутри темы;
- если вопрос явно остался открытым, пометь его как открытый;
- не превращай саммари в протокол решений и список поручений.`,
    userPromptTemplate:
      "Сформируй тематическое саммари встречи на русском языке. Используй только факты из transcript. Не придумывай имена, сроки, решения и поручения, которых нет в тексте. Markdown должен быть без заголовка первого уровня; разделы второго уровня — темы обсуждения. Верни только JSON с полями markdown и shortSummary. Поле markdown должно содержать markdown с темами и вопросами. Поле shortSummary должно содержать 1–2 предложения общего содержания встречи.",
  },
  {
    module: "meetings",
    promptKey: "meeting_protocol",
    title: "Протокол встречи",
    systemPrompt: `Ты анализируешь русскоязычные встречи и готовишь рабочий протокол.

Протокол должен отвечать на вопрос "что решили и что нужно сделать".

Содержательная структура:
- сгруппируй итог по темам встречи;
- внутри каждой темы отрази решения, поставленные задачи и ответственных;
- если ответственный или срок не прозвучал, прямо укажи "не указан";
- если по теме не было решений или задач, напиши "решения и задачи не зафиксированы";
- не пересказывай всю дискуссию, оставляй только управленчески значимый итог.`,
    userPromptTemplate:
      "Сформируй протокол встречи на русском языке. Используй только факты из transcript. Не придумывай имена, сроки, решения, задачи и ответственных, которых нет в тексте. Markdown должен быть без заголовка первого уровня; разделы второго уровня — темы встречи. По каждой теме покажи решения, задачи и ответственных, если они явно есть в transcript. Если ответственного или срока нет, укажи, что он не указан. Верни только JSON с полями markdown и shortSummary. Поле markdown должно содержать markdown-протокол по темам. Поле shortSummary должно содержать 1–2 предложения с главным итогом встречи.",
  },
  {
    module: "meetings",
    promptKey: "meeting_actions",
    title: "Поручения и решения по встрече",
    systemPrompt:
      "Ты анализируешь русскоязычные встречи и выделяешь решения, поручения и открытые вопросы.",
    userPromptTemplate:
      "Сформируй структурированные результаты встречи на русском языке. Используй только факты из transcript. Не придумывай имена, сроки, решения и поручения, которых нет в тексте. Верни только JSON с полями markdown, shortSummary, decisions, actionItems, openQuestions. Для actionItems указывай assignee и deadline только если они явно прозвучали. Для actionItems по возможности указывай sourceSegmentIds как массив segment_id из transcript.",
  },
] as const

const logger = new Logger("PostgresService")

const INTERNAL_POSTGRES_URL =
  "postgresql://postgres:postgres@postgres:5432/ecolms"
const EXTERNAL_POSTGRES_URL =
  "postgresql://postgres:postgres@localhost:5434/ecolms"

function defaultPostgresUrl() {
  return process.env.NODE_ENV === "production"
    ? INTERNAL_POSTGRES_URL
    : EXTERNAL_POSTGRES_URL
}

function normalizePostgresUrl(value: string | undefined) {
  if (!value) {
    return defaultPostgresUrl()
  }

  if (
    value.includes("localhost") ||
    value.includes("127.0.0.1")
  ) {
    return defaultPostgresUrl()
  }

  if (
    process.env.NODE_ENV !== "production" &&
    value.includes("ecolms-lmsdb-uloxp8")
  ) {
    return EXTERNAL_POSTGRES_URL
  }

  return value
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  name text NOT NULL,
  github_ref text NOT NULL,
  source_summary text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'uploaded', 'processing', 'awaiting_review', 'completed', 'failed')),
  current_stage text NOT NULL CHECK (current_stage IN ('source_compiled', 'course_outline', 'course_content', 'course_test')),
  progress integer NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  files integer NOT NULL DEFAULT 0 CHECK (files >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  overview text NOT NULL DEFAULT '',
  stage_drafts jsonb NOT NULL DEFAULT '{}'::jsonb,
  logs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_files (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  storage_key text NOT NULL,
  upload_status text NOT NULL CHECK (upload_status IN ('initiated', 'uploading', 'completed', 'aborted')),
  processing_status text NOT NULL CHECK (processing_status IN ('pending', 'queued', 'processing', 'done', 'failed')),
  kind text NOT NULL,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS source_files_project_position_idx
  ON source_files (project_id, position);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_file_id text NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  s3_upload_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('initiated', 'uploading', 'completed', 'aborted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  bucket text NOT NULL,
  storage_key text NOT NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  kind text NOT NULL
);

CREATE INDEX IF NOT EXISTS upload_sessions_project_status_idx
  ON upload_sessions (project_id, status);

CREATE TABLE IF NOT EXISTS processing_jobs (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('source_compiled', 'course_outline', 'course_content', 'course_test')),
  status text NOT NULL CHECK (status IN ('queued', 'processing', 'done', 'failed')),
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_json jsonb NULL,
  error_text text NULL,
  started_at timestamptz NULL,
  finished_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS processing_jobs_project_created_idx
  ON processing_jobs (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS processing_jobs_project_stage_status_idx
  ON processing_jobs (project_id, stage, status);

CREATE TABLE IF NOT EXISTS artifacts (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('source_compiled', 'course_outline', 'course_content', 'course_test')),
  format text NOT NULL CHECK (format IN ('md', 'json')),
  storage_key text NOT NULL,
  content_md text NOT NULL,
  content_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, stage, format)
);

CREATE INDEX IF NOT EXISTS artifacts_project_stage_format_idx
  ON artifacts (project_id, stage, format);

CREATE TABLE IF NOT EXISTS stage_reviews (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('source_compiled', 'course_outline', 'course_content', 'course_test')),
  source_artifact_id text NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  edited_artifact_id text NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  approved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, stage)
);

CREATE INDEX IF NOT EXISTS stage_reviews_project_stage_idx
  ON stage_reviews (project_id, stage);

CREATE TABLE IF NOT EXISTS meetings (
  id text PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('draft', 'uploaded', 'processing', 'completed', 'failed')),
  language text NOT NULL DEFAULT 'ru' CHECK (language IN ('ru')),
  duration_seconds integer NULL,
  speakers_count integer NOT NULL DEFAULT 0 CHECK (speakers_count >= 0),
  processing_started_at timestamptz NULL,
  processing_finished_at timestamptz NULL,
  error_text text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meeting_source_files (
  id text PRIMARY KEY,
  meeting_id text NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  storage_key text NOT NULL,
  upload_status text NOT NULL CHECK (upload_status IN ('initiated', 'uploading', 'completed', 'aborted')),
  processing_status text NOT NULL CHECK (processing_status IN ('pending', 'queued', 'processing', 'done', 'failed')),
  duration_seconds integer NULL,
  audio_storage_key text NULL,
  audio_mime_type text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id)
);

CREATE TABLE IF NOT EXISTS meeting_upload_sessions (
  id text PRIMARY KEY,
  meeting_id text NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  source_file_id text NOT NULL REFERENCES meeting_source_files(id) ON DELETE CASCADE,
  s3_upload_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('initiated', 'uploading', 'completed', 'aborted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  bucket text NOT NULL,
  storage_key text NOT NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0)
);

CREATE INDEX IF NOT EXISTS meeting_upload_sessions_meeting_status_idx
  ON meeting_upload_sessions (meeting_id, status);

CREATE TABLE IF NOT EXISTS meeting_jobs (
  id text PRIMARY KEY,
  meeting_id text NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('audio_prepared', 'transcript_compiled', 'meeting_summary', 'meeting_protocol', 'meeting_actions')),
  status text NOT NULL CHECK (status IN ('queued', 'processing', 'done', 'failed')),
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_json jsonb NULL,
  error_text text NULL,
  started_at timestamptz NULL,
  finished_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meeting_jobs_meeting_created_idx
  ON meeting_jobs (meeting_id, created_at DESC);

CREATE INDEX IF NOT EXISTS meeting_jobs_meeting_stage_status_idx
  ON meeting_jobs (meeting_id, stage, status);

CREATE TABLE IF NOT EXISTS meeting_speakers (
  id text PRIMARY KEY,
  meeting_id text NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  speaker_label text NOT NULL,
  display_name text NOT NULL,
  is_user_edited boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, speaker_label)
);

CREATE INDEX IF NOT EXISTS meeting_speakers_meeting_sort_idx
  ON meeting_speakers (meeting_id, sort_order);

CREATE TABLE IF NOT EXISTS meeting_speaker_segments (
  id bigserial PRIMARY KEY,
  meeting_id text NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  speaker_id text NULL REFERENCES meeting_speakers(id) ON DELETE SET NULL,
  speaker_label text NOT NULL,
  start_ms integer NOT NULL CHECK (start_ms >= 0),
  end_ms integer NOT NULL CHECK (end_ms >= start_ms),
  text text NOT NULL,
  confidence numeric NULL,
  provider_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meeting_segments_meeting_start_idx
  ON meeting_speaker_segments (meeting_id, start_ms);

CREATE INDEX IF NOT EXISTS meeting_segments_meeting_speaker_idx
  ON meeting_speaker_segments (meeting_id, speaker_label);

CREATE TABLE IF NOT EXISTS meeting_artifacts (
  id text PRIMARY KEY,
  meeting_id text NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('transcript_compiled', 'meeting_summary', 'meeting_protocol', 'meeting_actions')),
  format text NOT NULL CHECK (format IN ('md', 'json')),
  content_md text NOT NULL DEFAULT '',
  content_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, stage, format)
);

CREATE INDEX IF NOT EXISTS meeting_artifacts_meeting_stage_format_idx
  ON meeting_artifacts (meeting_id, stage, format);

CREATE TABLE IF NOT EXISTS llm_prompts (
  module text NOT NULL CHECK (module IN ('lms', 'meetings')),
  prompt_key text NOT NULL,
  title text NOT NULL,
  system_prompt text NOT NULL,
  user_prompt_template text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (module, prompt_key)
);

CREATE INDEX IF NOT EXISTS llm_prompts_module_idx
  ON llm_prompts (module, prompt_key);
`

function progressForStage(stage: StageId, status: ProjectStatus) {
  if (status === "completed") {
    return 100
  }

  switch (stage) {
    case "source_compiled":
      return status === "draft" ? 0 : 18
    case "course_outline":
      return 44
    case "course_content":
      return 68
    case "course_test":
      return 88
  }
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) {
    return fallback
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }

  return value as T
}

function isProjectStatus(value: string): value is ProjectStatus {
  return (
    value === "draft" ||
    value === "uploaded" ||
    value === "processing" ||
    value === "completed" ||
    value === "failed"
  )
}

function isStageId(value: string): value is StageId {
  return stageOrder.includes(value as StageId)
}

function makeSeedProject(options: {
  id: string
  prefix: string
  githubRef: string
  sourceSummary: string
  topic: string
  overview: string
  status: ProjectStatus
  currentStage: StageId
  progress: number
  files: number
  updatedAt: string
  logs: string[]
}): ProjectDetailRecord {
  const name = `${options.prefix} ${options.id.split("-").at(-1)}`
  const stageDrafts = {
    source_compiled: `# ${name}\n\n## Что уже известно\n- ${options.topic}\n- Совмещаем видео и документы в одном проекте.\n- Итог хранится только в S3.\n\n## Что удаляем\n- контакты, если они не нужны для обучения;\n- рекламный шум;\n- повторы из вебинаров.\n`,
    course_outline: `# План курса\n\n1. Введение в ${options.topic}\n2. Ключевые материалы\n3. Практика и примеры\n4. Типовые ошибки\n5. Проверка понимания\n`,
    course_content: `# Обучающие материалы\n\n## Раздел 1. Введение\nКратко объясняем, зачем нужен материал и кому он адресован.\n\n## Раздел 2. Практика\nДаём пошаговые инструкции без жаргона и лишних деталей.\n`,
    course_test: `# Тест\n\n1. Какой шаг следует после source_compiled?\n   - План курса\n   - Список файлов\n   - Архив проекта\n2. Сколько вопросов должно быть в тесте?\n   - 5\n   - 10\n   - 15\n`,
  }

  return {
    id: options.id,
    name,
    githubRef: options.githubRef,
    sourceSummary: options.sourceSummary,
    status: options.status,
    currentStage: options.currentStage,
    progress: options.progress,
    files: options.files,
    updatedAt: options.updatedAt,
    overview: options.overview,
    stageDrafts,
    stages: [],
    logs: options.logs,
    sourceFiles: [],
    artifacts: [],
    jobs: [],
    reviews: [],
  }
}

@Injectable()
export class PostgresService implements OnModuleInit, OnModuleDestroy {
  private readonly pool: Pool
  private initialized = false

  constructor() {
    const connectionString = normalizePostgresUrl(process.env.POSTGRES_URL)
    if (!connectionString) {
      throw new Error("POSTGRES_URL is required")
    }

    this.pool = new Pool({
      connectionString,
      max: 10,
    })
  }

  async onModuleInit() {
    if (this.initialized) {
      return
    }

    await this.pool.query(SCHEMA_SQL)
    await this.seedPrompts()
    await this.seedIfEmpty()
    this.initialized = true
    logger.log("PostgreSQL schema is ready")
  }

  async onModuleDestroy() {
    await this.pool.end()
  }

  async query<T extends QueryResultRow = Record<string, unknown>>(
    text: string,
    values: unknown[] = []
  ) {
    return this.pool.query<T>(text, values)
  }

  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")
      const result = await callback(client)
      await client.query("COMMIT")
      return result
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async countProjects() {
    const { rows } = await this.query<{ count: string }>("select count(*)::text as count from projects")
    return Number(rows[0]?.count ?? 0)
  }

  async stats() {
    const { rows } = await this.query<{
      projects: string
      uploads: string
    }>(`
      select
        (select count(*)::text from projects) as projects,
        (select count(*)::text from upload_sessions) as uploads
    `)
    return {
      projects: Number(rows[0]?.projects ?? 0),
      uploads: Number(rows[0]?.uploads ?? 0),
    }
  }

  private async seedPrompts() {
    for (const prompt of DEFAULT_PROMPT_SEEDS) {
      await this.query(
        `
        insert into llm_prompts (
          module, prompt_key, title, system_prompt, user_prompt_template, created_at, updated_at
        ) values (
          $1, $2, $3, $4, $5, now(), now()
        )
        on conflict (module, prompt_key) do nothing
        `,
        [
          prompt.module,
          prompt.promptKey,
          prompt.title,
          prompt.systemPrompt,
          prompt.userPromptTemplate,
        ]
      )
    }

    const defaultPromptUpgrades = [
      {
        promptKey: "meeting_summary",
        oldSystemNeedle: "Верни только JSON",
      },
      {
        promptKey: "meeting_protocol",
        oldSystemNeedle: "Верни только JSON",
      },
      {
        promptKey: "meeting_actions",
        oldSystemNeedle:
          "Не придумывай имена, сроки, решения и поручения, которых нет в тексте.",
      },
    ]

    for (const upgrade of defaultPromptUpgrades) {
      const prompt = DEFAULT_PROMPT_SEEDS.find(
        (item) =>
          item.module === "meetings" && item.promptKey === upgrade.promptKey
      )
      if (!prompt) {
        continue
      }

      await this.query(
        `
        update llm_prompts
        set
          title = $3,
          system_prompt = $4,
          user_prompt_template = $5,
          updated_at = now()
        where module = $1
          and prompt_key = $2
          and position($6 in system_prompt) > 0
        `,
        [
          prompt.module,
          prompt.promptKey,
          prompt.title,
          prompt.systemPrompt,
          prompt.userPromptTemplate,
          upgrade.oldSystemNeedle,
        ]
      )
    }
  }

  private async seedIfEmpty() {
    const projectsCount = await this.countProjects()
    if (projectsCount > 0) {
      return
    }

    const seeds = [
      makeSeedProject({
        id: "eco-001",
        prefix: "EcoGlass sales enablement",
        githubRef: "github.com/pl-ecookna/EcoLMS/issues/218",
        sourceSummary: "Вебинар + PDF для отдела продаж",
        topic: "продаж светопрозрачных конструкций",
        overview:
          "Материал для менеджеров, которые ведут первые консультации и собирают потребности клиента.",
        status: "uploaded",
        currentStage: "course_outline",
        progress: 68,
        files: 3,
        updatedAt: new Date().toISOString(),
        logs: [
          "Загрузка завершена без ошибок.",
          "Из видео извлечено аудио и отправлено в Whisper.",
          "Черновик source_compiled ожидает ручной проверки.",
        ],
      }),
      makeSeedProject({
        id: "eco-002",
        prefix: "Монтаж и сервис",
        githubRef: "github.com/pl-ecookna/EcoLMS/issues/227",
        sourceSummary: "DOC + видеозапись сервисного инструктажа",
        topic: "сервиса и монтажа",
        overview:
          "Пошаговый разбор типовых работ и контрольных чек-листов для полевой команды.",
        status: "processing",
        currentStage: "course_content",
        progress: 44,
        files: 2,
        updatedAt: new Date().toISOString(),
        logs: [
          "Очистка текста завершена.",
          "Сформирован план курса на 6 разделов.",
          "Генерация материалов сейчас в очереди.",
        ],
      }),
      makeSeedProject({
        id: "eco-003",
        prefix: "Производство и качество",
        githubRef: "github.com/pl-ecookna/EcoLMS/issues/233",
        sourceSummary: "PPTX, PDF и стенограмма созвона",
        topic: "производства и контроля качества",
        overview:
          "Материал для производственных мастеров с акцентом на контроль узлов и брак.",
        status: "uploaded",
        currentStage: "source_compiled",
        progress: 18,
        files: 4,
        updatedAt: new Date().toISOString(),
        logs: [
          "Файлы загружены в Beget S3.",
          "Проект готов к запуску обработки.",
          "Ожидается подтверждение от пользователя.",
        ],
      }),
      makeSeedProject({
        id: "eco-004",
        prefix: "Коммерческое предложение",
        githubRef: "github.com/pl-ecookna/EcoLMS/issues/240",
        sourceSummary: "PDF КП и дополнительная презентация",
        topic: "подготовки коммерческих предложений",
        overview:
          "Пакет материалов для ускоренной подготовки КП на основе реальных документов заказчика.",
        status: "completed",
        currentStage: "course_test",
        progress: 100,
        files: 5,
        updatedAt: new Date().toISOString(),
        logs: [
          "Все этапы подтверждены.",
          "Итоговый пакет сформирован.",
          "Артефакты доступны для скачивания.",
        ],
      }),
    ]

    for (const seed of seeds) {
      await this.transaction(async (client) => {
        await client.query(
          `
          insert into projects (
            id, name, github_ref, source_summary, status, current_stage, progress, files, updated_at, overview, stage_drafts, logs
          ) values (
            $1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10, $11::jsonb, $12::jsonb
          )
          on conflict (id) do nothing
        `,
          [
            seed.id,
            seed.name,
            seed.githubRef,
            seed.sourceSummary,
            seed.status,
            seed.currentStage,
            seed.progress,
            seed.files,
            seed.updatedAt,
            seed.overview,
            JSON.stringify(seed.stageDrafts),
            JSON.stringify(seed.logs),
          ]
        )

        await this.seedProjectRelations(client, seed)
      })
    }
  }

  private async seedProjectRelations(client: PoolClient, seed: ProjectDetailRecord) {
    for (const [index, file] of Array.from({ length: seed.files }, (_, idx) => idx + 1).entries()) {
      const fileIndex = index + 1
      const isDocument = fileIndex % 2 === 1
      const fileId = `${seed.id}-file-${fileIndex}`
      await client.query(
        `
        insert into source_files (
          id, project_id, original_name, mime_type, size_bytes, storage_key, upload_status, processing_status, kind, position, created_at
        ) values (
          $1, $2, $3, $4, $5, $6, 'completed', 'done', $7, $8, now()
        )
        on conflict (id) do nothing
      `,
        [
          fileId,
          seed.id,
          `source-${fileIndex}.${isDocument ? "pdf" : "mp4"}`,
          isDocument ? "application/pdf" : "video/mp4",
          42_000_000,
          `source/${seed.id}/source-${fileIndex}`,
          isDocument ? "document" : "video",
          fileIndex,
        ]
      )
    }

    for (const stage of stageOrder) {
      await client.query(
        `
        insert into artifacts (
          id, project_id, stage, format, storage_key, content_md, content_json, created_at, updated_at
        ) values
        ($1, $2, $3, 'md', $4, $5, $6::jsonb, now(), now()),
        ($7, $8, $9, 'json', $10, $11, $12::jsonb, now(), now())
        on conflict (project_id, stage, format) do nothing
      `,
        [
          `${seed.id}-${stage}-md`,
          seed.id,
          stage,
          `artifacts/${seed.id}/${stage}.md`,
          seed.stageDrafts[stage],
          JSON.stringify({ stage, markdown: seed.stageDrafts[stage] }),
          `${seed.id}-${stage}-json`,
          seed.id,
          stage,
          `artifacts/${seed.id}/${stage}.json`,
          seed.stageDrafts[stage],
          JSON.stringify({ stage, markdown: seed.stageDrafts[stage] }),
        ]
      )
    }

    await client.query(
      `
      insert into processing_jobs (
        id, project_id, stage, status, payload_json, result_json, error_text, started_at, finished_at, created_at
      ) values (
        $1, $2, $3, $4, $5::jsonb, $6::jsonb, null, now(), $7::timestamptz, now()
      )
      on conflict (id) do nothing
    `,
      [
        `${seed.id}-job-1`,
        seed.id,
        seed.currentStage,
        seed.status === "completed" ? "done" : "processing",
        JSON.stringify({ stage: seed.currentStage }),
        JSON.stringify({ status: seed.status }),
        seed.status === "completed" ? new Date().toISOString() : null,
      ]
    )
  }

}

type ProjectRow = {
  id: string
  name: string
  github_ref: string
  source_summary: string
  status: string
  current_stage: string
  progress: number
  files: number
  updated_at: string
  overview: string
  stage_drafts: unknown
  logs: unknown
}

type SourceFileRow = {
  id: string
  project_id: string
  original_name: string
  mime_type: string
  size_bytes: number
  storage_key: string
  upload_status: string
  processing_status: string
  kind: string
  position: number
  created_at: string
}

type UploadSessionRow = {
  id: string
  project_id: string
  source_file_id: string
  s3_upload_id: string
  status: string
  created_at: string
  completed_at: string | null
  bucket: string
  storage_key: string
  original_name: string
  mime_type: string
  size_bytes: number
  kind: string
}

type ProcessingJobRow = {
  id: string
  project_id: string
  stage: string
  status: string
  payload_json: unknown
  result_json: unknown
  error_text: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
}

type ArtifactRow = {
  id: string
  project_id: string
  stage: string
  format: string
  storage_key: string
  content_md: string
  content_json: unknown
  created_at: string
  updated_at: string
}

type StageReviewRow = {
  id: string
  project_id: string
  stage: string
  source_artifact_id: string
  edited_artifact_id: string
  approved_at: string
}

function mapSourceFileRow(row: SourceFileRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    storageKey: row.storage_key,
    uploadStatus: row.upload_status as "initiated" | "uploading" | "completed" | "aborted",
    processingStatus: row.processing_status as "pending" | "queued" | "processing" | "done" | "failed",
    kind: row.kind,
    position: Number(row.position),
    createdAt: row.created_at,
  }
}

function mapUploadSessionRow(row: UploadSessionRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceFileId: row.source_file_id,
    s3UploadId: row.s3_upload_id,
    status: row.status as "initiated" | "uploading" | "completed" | "aborted",
    createdAt: row.created_at,
    completedAt: row.completed_at,
    bucket: row.bucket,
    storageKey: row.storage_key,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    kind: row.kind,
  }
}

function mapProcessingJobRow(row: ProcessingJobRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    stage: row.stage as StageId,
    status: row.status as "queued" | "processing" | "done" | "failed",
    payloadJson: parseJson<Record<string, unknown>>(row.payload_json, {}),
    resultJson: parseJson<Record<string, unknown> | null>(row.result_json, null),
    errorText: row.error_text,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  }
}

function mapArtifactRow(row: ArtifactRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    stage: row.stage as StageId,
    format: row.format as "md" | "json",
    storageKey: row.storage_key,
    contentMd: row.content_md,
    contentJson: parseJson<Record<string, unknown>>(row.content_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapReviewRow(row: StageReviewRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    stage: row.stage as StageId,
    sourceArtifactId: row.source_artifact_id,
    editedArtifactId: row.edited_artifact_id,
    approvedAt: row.approved_at,
  }
}

function buildStages(
  currentStage: StageId,
  status: ProjectStatus,
  updatedAt: string
): ProjectStageRecord[] {
  const currentIndex = stageOrder.indexOf(currentStage)

  return stageOrder.map((stageId, index) => {
    const isCompleted = status === "completed" || index < currentIndex
    const isActive = index === currentIndex && status !== "completed"

    return {
      id: stageId,
      status: isCompleted ? "done" : isActive ? "processing" : "queued",
      note:
        stageId === "source_compiled"
          ? "Нормализация исходников и удаление шума."
          : stageId === "course_outline"
            ? "Строим структуру курса до 10 разделов."
            : stageId === "course_content"
              ? "Разворачиваем материалы в обучающий текст."
              : "Формируем базовый тест из 10 вопросов.",
      updatedAt: isCompleted || isActive ? updatedAt : "ожидает старта",
    }
  })
}
