# Project Database Schema (Supabase)

This file contains the Supabase database schema for the project. When generating SQL, writing API integrations, or structuring data exports, always adhere to the table definitions, foreign key constraints, and default values defined below.

```sql
CREATE TABLE public.bac_exams (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  exam_code text NOT NULL UNIQUE,
  exam_level text NOT NULL CHECK (exam_level = ANY (ARRAY['regional'::text, 'national'::text])),
  academic_year_order integer NOT NULL,
  name text NOT NULL,
  description text,
  track_id uuid,
  section_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT bac_exams_pkey PRIMARY KEY (id),
  CONSTRAINT bac_exams_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.bac_tracks(id),
  CONSTRAINT bac_exams_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.bac_sections(id)
);
CREATE TABLE public.bac_international_options (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  option_code text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT bac_international_options_pkey PRIMARY KEY (id)
);
CREATE TABLE public.bac_sections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  section_code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT bac_sections_pkey PRIMARY KEY (id)
);
CREATE TABLE public.bac_track_international_options (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  track_id uuid NOT NULL,
  option_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT bac_track_international_options_pkey PRIMARY KEY (id),
  CONSTRAINT bac_track_international_options_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.bac_tracks(id),
  CONSTRAINT bac_track_international_options_option_id_fkey FOREIGN KEY (option_id) REFERENCES public.bac_international_options(id)
);
CREATE TABLE public.bac_track_subjects (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  track_id uuid,
  subject_id uuid,
  CONSTRAINT bac_track_subjects_pkey PRIMARY KEY (id),
  CONSTRAINT bac_track_subjects_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.bac_tracks(id),
  CONSTRAINT bac_track_subjects_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id)
);
CREATE TABLE public.bac_tracks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL,
  track_code text NOT NULL,
  name text NOT NULL,
  description text,
  track_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT bac_tracks_pkey PRIMARY KEY (id),
  CONSTRAINT bac_tracks_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.bac_sections(id)
);
CREATE TABLE public.curricula (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  country text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT curricula_pkey PRIMARY KEY (id)
);
CREATE TABLE public.cycles (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  curriculum_id uuid NOT NULL,
  name text NOT NULL,
  cycle_order integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT cycles_pkey PRIMARY KEY (id),
  CONSTRAINT cycles_curriculum_id_fkey FOREIGN KEY (curriculum_id) REFERENCES public.curricula(id)
);
CREATE TABLE public.embeddings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  lesson_id uuid,
  content text NOT NULL,
  embedding USER-DEFINED,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT embeddings_pkey PRIMARY KEY (id),
  CONSTRAINT embeddings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT embeddings_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.user_lessons(id)
);
CREATE TABLE public.exam_exercises (
  exam_id uuid NOT NULL,
  exercise_id uuid NOT NULL,
  year integer,
  session text,
  CONSTRAINT exam_exercises_pkey PRIMARY KEY (exam_id, exercise_id),
  CONSTRAINT exam_exercises_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.bac_exams(id),
  CONSTRAINT exam_exercises_exercise_id_fkey FOREIGN KEY (exercise_id) REFERENCES public.exercises(id)
);
CREATE TABLE public.exercise_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  exercise_id uuid NOT NULL,
  user_solution text NOT NULL,
  is_correct boolean NOT NULL,
  xp_earned integer DEFAULT 0,
  feedback text,
  attempted_at timestamp with time zone DEFAULT now(),
  score double precision DEFAULT 0,
  CONSTRAINT exercise_attempts_pkey PRIMARY KEY (id),
  CONSTRAINT exercise_attempts_exercise_id_fkey FOREIGN KEY (exercise_id) REFERENCES public.exercises(id),
  CONSTRAINT exercise_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.exercise_skills (
  exercise_id uuid NOT NULL,
  skill_id uuid NOT NULL,
  weight double precision DEFAULT 1,
  CONSTRAINT exercise_skills_pkey PRIMARY KEY (exercise_id, skill_id),
  CONSTRAINT exercise_skills_exercise_id_fkey FOREIGN KEY (exercise_id) REFERENCES public.exercises(id),
  CONSTRAINT exercise_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id)
);
CREATE TABLE public.exercises (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lesson_id uuid,
  title text NOT NULL,
  prompt text NOT NULL,
  solution text NOT NULL,
  hints ARRAY DEFAULT '{}'::text[],
  difficulty text DEFAULT 'medium'::text CHECK (difficulty = ANY (ARRAY['easy'::text, 'medium'::text, 'hard'::text])),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  topic_id uuid,
  type text DEFAULT 'problem'::text,
  CONSTRAINT exercises_pkey PRIMARY KEY (id),
  CONSTRAINT exercises_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.user_lessons(id),
  CONSTRAINT exercises_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.topics(id)
);
CREATE TABLE public.grade_subjects (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  grade_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT grade_subjects_pkey PRIMARY KEY (id),
  CONSTRAINT grade_subjects_grade_id_fkey FOREIGN KEY (grade_id) REFERENCES public.grades(id),
  CONSTRAINT grade_subjects_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id)
);
CREATE TABLE public.grades (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  cycle_id uuid NOT NULL,
  name text NOT NULL,
  grade_order integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT grades_pkey PRIMARY KEY (id),
  CONSTRAINT grades_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.cycles(id)
);
CREATE TABLE public.lesson_blocks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lesson_id uuid,
  type text CHECK (type = ANY (ARRAY['text'::text, 'example'::text, 'formula'::text, 'summary'::text])),
  content text NOT NULL,
  order_index integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT lesson_blocks_pkey PRIMARY KEY (id),
  CONSTRAINT lesson_blocks_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.lessons(id)
);
CREATE TABLE public.lessons (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  country text NOT NULL,
  grade text NOT NULL,
  subject text NOT NULL,
  lesson_title text NOT NULL,
  content text NOT NULL,
  exercises jsonb DEFAULT '[]'::jsonb,
  quizzes jsonb DEFAULT '[]'::jsonb,
  mod text,
  exam jsonb,
  embedding USER-DEFINED,
  author_id uuid,
  is_ai_generated boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT lessons_pkey PRIMARY KEY (id),
  CONSTRAINT lessons_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id)
);
CREATE TABLE public.modules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  code text NOT NULL,
  description text,
  category text,
  progress integer DEFAULT 0,
  selected boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  tags ARRAY,
  CONSTRAINT modules_pkey PRIMARY KEY (id),
  CONSTRAINT modules_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  lesson_id uuid,
  content text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notes_pkey PRIMARY KEY (id),
  CONSTRAINT notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT notes_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.user_lessons(id)
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  email text NOT NULL UNIQUE,
  full_name text,
  avatar_url text,
  plan text DEFAULT 'free'::text CHECK (plan = ANY (ARRAY['free'::text, 'pro'::text])),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  role text DEFAULT 'user'::text,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.quiz_results (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  quiz_id uuid NOT NULL,
  score integer NOT NULL,
  total_questions integer NOT NULL,
  xp_earned integer DEFAULT 0,
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  completed_at timestamp with time zone DEFAULT now(),
  CONSTRAINT quiz_results_pkey PRIMARY KEY (id),
  CONSTRAINT quiz_results_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT quiz_results_quiz_id_fkey FOREIGN KEY (quiz_id) REFERENCES public.quizzes(id)
);
CREATE TABLE public.quizzes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  lesson_id uuid,
  title text NOT NULL,
  description text,
  difficulty text DEFAULT 'medium'::text CHECK (difficulty = ANY (ARRAY['easy'::text, 'medium'::text, 'hard'::text])),
  time_limit integer,
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT quizzes_pkey PRIMARY KEY (id),
  CONSTRAINT quizzes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT quizzes_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.user_lessons(id)
);
CREATE TABLE public.rag_chunks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  content text NOT NULL,
  embedding USER-DEFINED,
  source_type text CHECK (source_type = ANY (ARRAY['lesson_block'::text, 'exercise'::text, 'exam'::text])),
  source_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT rag_chunks_pkey PRIMARY KEY (id)
);
CREATE TABLE public.schedule (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  date date NOT NULL,
  month text NOT NULL,
  title text NOT NULL,
  time text,
  location text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT schedule_pkey PRIMARY KEY (id),
  CONSTRAINT schedule_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.settings (
  key text NOT NULL,
  user_id uuid NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT settings_pkey PRIMARY KEY (key, user_id),
  CONSTRAINT settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.skills (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  subject_id uuid,
  name text NOT NULL,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT skills_pkey PRIMARY KEY (id),
  CONSTRAINT skills_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id)
);
CREATE TABLE public.subjects (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name text NOT NULL UNIQUE,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT subjects_pkey PRIMARY KEY (id)
);
CREATE TABLE public.tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  completed boolean DEFAULT false,
  due_date timestamp with time zone,
  type text DEFAULT 'general'::text CHECK (type = ANY (ARRAY['assignment'::text, 'reading'::text, 'quiz'::text, 'general'::text, 'exam'::text, 'controle'::text])),
  created_at timestamp with time zone DEFAULT now(),
  tags ARRAY,
  CONSTRAINT tasks_pkey PRIMARY KEY (id),
  CONSTRAINT tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.topic_outlines (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  outline_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT topic_outlines_pkey PRIMARY KEY (id),
  CONSTRAINT topic_outlines_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.topics(id)
);
CREATE TABLE public.topic_skills (
  topic_id uuid NOT NULL,
  skill_id uuid NOT NULL,
  CONSTRAINT topic_skills_pkey PRIMARY KEY (topic_id, skill_id),
  CONSTRAINT topic_skills_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.topics(id),
  CONSTRAINT topic_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id)
);
CREATE TABLE public.topics (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  grade_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  title text NOT NULL,
  topic_order integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT topics_pkey PRIMARY KEY (id),
  CONSTRAINT topics_grade_id_fkey FOREIGN KEY (grade_id) REFERENCES public.grades(id),
  CONSTRAINT topics_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id)
);
CREATE TABLE public.user_lessons (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  module_id uuid,
  title text NOT NULL,
  subtitle text,
  content text,
  status text DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['suggested'::text, 'pending'::text, 'active'::text, 'done'::text])),
  blocks jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  tags ARRAY,
  CONSTRAINT user_lessons_pkey PRIMARY KEY (id),
  CONSTRAINT lessons_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT lessons_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.modules(id)
);
CREATE TABLE public.user_skills (
  user_id uuid NOT NULL,
  skill_id uuid NOT NULL,
  level double precision DEFAULT 0,
  confidence double precision DEFAULT 0,
  last_updated timestamp with time zone DEFAULT now(),
  CONSTRAINT user_skills_pkey PRIMARY KEY (user_id, skill_id),
  CONSTRAINT user_skills_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT user_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id)
);
```
