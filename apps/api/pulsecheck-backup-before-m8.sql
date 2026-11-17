--
-- PostgreSQL database dump
--

\restrict PndZRBECtJDiXZ6kP4KhjOInMgHclVsoTwjZZYtCN7FP2mHHIjAHbEWU89DTbVJ

-- Dumped from database version 17.11 (Debian 17.11-1.pgdg13+2)
-- Dumped by pg_dump version 17.11 (Debian 17.11-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: CheckStatus; Type: TYPE; Schema: public; Owner: pulsecheck
--

CREATE TYPE public."CheckStatus" AS ENUM (
    'UP',
    'DOWN'
);


ALTER TYPE public."CheckStatus" OWNER TO pulsecheck;

--
-- Name: MonitorHealthStatus; Type: TYPE; Schema: public; Owner: pulsecheck
--

CREATE TYPE public."MonitorHealthStatus" AS ENUM (
    'UNKNOWN',
    'UP',
    'DOWN'
);


ALTER TYPE public."MonitorHealthStatus" OWNER TO pulsecheck;

--
-- Name: MonitorStatus; Type: TYPE; Schema: public; Owner: pulsecheck
--

CREATE TYPE public."MonitorStatus" AS ENUM (
    'ACTIVE',
    'PAUSED'
);


ALTER TYPE public."MonitorStatus" OWNER TO pulsecheck;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: CheckResult; Type: TABLE; Schema: public; Owner: pulsecheck
--

CREATE TABLE public."CheckResult" (
    id text NOT NULL,
    status public."CheckStatus" NOT NULL,
    "statusCode" integer,
    "responseTimeMs" integer,
    "errorMessage" text,
    "checkedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "monitorId" text NOT NULL
);


ALTER TABLE public."CheckResult" OWNER TO pulsecheck;

--
-- Name: Monitor; Type: TABLE; Schema: public; Owner: pulsecheck
--

CREATE TABLE public."Monitor" (
    id text NOT NULL,
    name text NOT NULL,
    url text NOT NULL,
    "intervalSeconds" integer DEFAULT 300 NOT NULL,
    status public."MonitorStatus" DEFAULT 'ACTIVE'::public."MonitorStatus" NOT NULL,
    "consecutiveFailures" integer DEFAULT 0 NOT NULL,
    "lastCheckedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "userId" text NOT NULL,
    "healthStatus" public."MonitorHealthStatus" DEFAULT 'UNKNOWN'::public."MonitorHealthStatus" NOT NULL
);


ALTER TABLE public."Monitor" OWNER TO pulsecheck;

--
-- Name: User; Type: TABLE; Schema: public; Owner: pulsecheck
--

CREATE TABLE public."User" (
    id text NOT NULL,
    email text NOT NULL,
    name text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "passwordHash" text NOT NULL
);


ALTER TABLE public."User" OWNER TO pulsecheck;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: pulsecheck
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public._prisma_migrations OWNER TO pulsecheck;

--
-- Data for Name: CheckResult; Type: TABLE DATA; Schema: public; Owner: pulsecheck
--

COPY public."CheckResult" (id, status, "statusCode", "responseTimeMs", "errorMessage", "checkedAt", "monitorId") FROM stdin;
cmvqhf2up0001zj24w4mfczzu	UP	200	723	\N	2026-10-27 09:27:20.102	cmvqfvs2v0001zjjgrk9cmyj6
cmvqi8smq0001zjbwogb03wvl	UP	200	836	\N	2026-10-27 09:50:26.541	cmvqfvs2v0001zjjgrk9cmyj6
cmvqi8u9o0003zjbwtsi2q2rm	UP	200	209	\N	2026-10-27 09:50:28.665	cmvqfvs2v0001zjjgrk9cmyj6
cmvqi8vi20005zjbwakk5a8l5	UP	200	249	\N	2026-10-27 09:50:30.263	cmvqfvs2v0001zjjgrk9cmyj6
cmvqj4dyw0001zjropokbjpok	UP	200	458	\N	2026-10-27 10:15:00.528	cmvqfvs2v0001zjjgrk9cmyj6
cmvqjc3uj0001zjb4hah6rgml	UP	200	634	\N	2026-10-27 10:21:00.66	cmvqfvs2v0001zjjgrk9cmyj6
cmvqjjtn80003zjb4mtix55fp	UP	200	659	\N	2026-10-27 10:27:00.687	cmvqfvs2v0001zjjgrk9cmyj6
cmvqjrjo10005zjb4vdz47awq	UP	200	967	\N	2026-10-27 10:33:01.002	cmvqfvs2v0001zjjgrk9cmyj6
cmvqt0ozp0001zjik9vuq1zuy	UP	200	4309	\N	2026-10-27 14:52:04.35	cmvqfvs2v0001zjjgrk9cmyj6
cmvqt8c0d0001zj90scd33hii	UP	200	758	\N	2026-10-27 14:58:00.776	cmvqfvs2v0001zjjgrk9cmyj6
cmvqtg1go0003zj909xy762pu	UP	200	317	\N	2026-10-27 15:04:00.34	cmvqfvs2v0001zjjgrk9cmyj6
cmvqtnrmm0001zjmsct8m4q4y	UP	200	818	\N	2026-10-27 15:10:00.857	cmvqfvs2v0001zjjgrk9cmyj6
cmvs6tb430001zjrkrksg94oc	UP	200	457	\N	2026-10-28 14:06:00.57	cmvqfvs2v0001zjjgrk9cmyj6
cmvs710rn0003zjrk632ohxgs	UP	200	388	\N	2026-10-28 14:12:00.413	cmvqfvs2v0001zjjgrk9cmyj6
cmvs78qii0007zjrkdubxavfa	UP	200	359	\N	2026-10-28 14:18:00.371	cmvqfvs2v0001zjjgrk9cmyj6
cmvs78qkz0009zjrkqb6pianm	UP	200	60	\N	2026-10-28 14:18:00.463	cmvs78pja0005zjrkj0rm1h3o
cmvs7ecca000bzjrkap2vc81d	UP	200	73	\N	2026-10-28 14:22:21.936	cmvs78pja0005zjrkj0rm1h3o
cmvs7ggdb000dzjrkgxdw2w1y	UP	200	439	\N	2026-10-28 14:24:00.47	cmvqfvs2v0001zjjgrk9cmyj6
cmvs7ll8z000fzjrko5qh6e57	UP	200	5	\N	2026-10-28 14:28:00.081	cmvs78pja0005zjrkj0rm1h3o
cmvs7o6wb000hzjrks73evscz	UP	200	1423	\N	2026-10-28 14:30:01.446	cmvqfvs2v0001zjjgrk9cmyj6
cmvs7tb02000jzjrk1wrx4mt7	UP	200	4	\N	2026-10-28 14:34:00.048	cmvs78pja0005zjrkj0rm1h3o
cmvs7vvp4000lzjrk7hhy9p3a	UP	200	167	\N	2026-10-28 14:36:00.181	cmvqfvs2v0001zjjgrk9cmyj6
cmvs810s4000nzjrkid60vzy9	UP	200	3	\N	2026-10-28 14:40:00.05	cmvs78pja0005zjrkj0rm1h3o
cmvs83lgj000pzjrkuniooz7j	UP	200	123	\N	2026-10-28 14:42:00.158	cmvqfvs2v0001zjjgrk9cmyj6
cmvs8bnrx000rzjrk93qz2yix	UP	200	352	\N	2026-10-28 14:48:16.405	cmvqfvs2v0001zjjgrk9cmyj6
cmvs8bnu4000tzjrky8v3bmte	UP	200	9	\N	2026-10-28 14:48:16.485	cmvs78pja0005zjrkj0rm1h3o
cmvs8j115000vzjrk6qqnm4d3	UP	200	130	\N	2026-10-28 14:54:00.182	cmvqfvs2v0001zjjgrk9cmyj6
cmvs8j122000xzjrkgpmpg1mr	UP	200	6	\N	2026-10-28 14:54:00.215	cmvs78pja0005zjrkj0rm1h3o
cmvs8qr0c000zzjrkyq3a3yd7	UP	200	396	\N	2026-10-28 15:00:00.442	cmvqfvs2v0001zjjgrk9cmyj6
cmvs8qr0r0011zjrkkazzak61	UP	200	3	\N	2026-10-28 15:00:00.458	cmvs78pja0005zjrkj0rm1h3o
cmvs8ygnh0013zjrksl5u7hd4	UP	200	201	\N	2026-10-28 15:06:00.263	cmvqfvs2v0001zjjgrk9cmyj6
cmvs8ygop0015zjrkmmyzgwsp	DOWN	500	4	\N	2026-10-28 15:06:00.31	cmvs78pja0005zjrkj0rm1h3o
cmvs966ew0017zjrklrgcgau6	UP	200	196	\N	2026-10-28 15:12:00.242	cmvqfvs2v0001zjjgrk9cmyj6
cmvs966fw0019zjrkvwzvwoqp	DOWN	500	4	\N	2026-10-28 15:12:00.282	cmvs78pja0005zjrkj0rm1h3o
cmvs9dwba001bzjrk08y7vcnl	UP	200	309	\N	2026-10-28 15:18:00.389	cmvqfvs2v0001zjjgrk9cmyj6
cmvs9dwc7001dzjrktjzl5vt9	DOWN	500	4	\N	2026-10-28 15:18:00.426	cmvs78pja0005zjrkj0rm1h3o
cmvs9lm19001fzjrkyjysfyga	UP	200	254	\N	2026-10-28 15:24:00.321	cmvqfvs2v0001zjjgrk9cmyj6
cmvs9lm1z001hzjrk8fyh4d1r	DOWN	500	5	\N	2026-10-28 15:24:00.348	cmvs78pja0005zjrkj0rm1h3o
cmvs9tbr1001jzjrk2q8cqhtu	UP	200	185	\N	2026-10-28 15:30:00.245	cmvqfvs2v0001zjjgrk9cmyj6
cmvs9tbro001lzjrk6gimx27b	DOWN	500	4	\N	2026-10-28 15:30:00.269	cmvs78pja0005zjrkj0rm1h3o
cmvs9y6yr001nzjrkrx1r6ykd	DOWN	500	3	\N	2026-10-28 15:33:47.328	cmvs78pja0005zjrkj0rm1h3o
cmvsa11ui001pzjrk0vf5d06n	UP	200	573	\N	2026-10-28 15:36:00.655	cmvqfvs2v0001zjjgrk9cmyj6
cmvsa4w99001rzjrk4mda1y9m	DOWN	500	7	\N	2026-10-28 15:39:00.042	cmvs78pja0005zjrkj0rm1h3o
cmvsa8ra8001tzjrk1of4hu8w	UP	200	135	\N	2026-10-28 15:42:00.218	cmvqfvs2v0001zjjgrk9cmyj6
cmvsaayf9001vzjrko0qw7yap	UP	200	4	\N	2026-10-28 15:43:42.785	cmvs78pja0005zjrkj0rm1h3o
cmvta3xgk0001zj60j9llx3qo	UP	200	674	\N	2026-10-29 08:26:01.11	cmvqfvs2v0001zjjgrk9cmyj6
cmvta3xo60003zj60yj71ugrx	UP	200	243	\N	2026-10-29 08:26:01.395	cmvs78pja0005zjrkj0rm1h3o
\.


--
-- Data for Name: Monitor; Type: TABLE DATA; Schema: public; Owner: pulsecheck
--

COPY public."Monitor" (id, name, url, "intervalSeconds", status, "consecutiveFailures", "lastCheckedAt", "createdAt", "updatedAt", "userId", "healthStatus") FROM stdin;
cmvqfvs2v0001zjjgrk9cmyj6	Example Website	https://example.com	300	ACTIVE	0	2026-10-29 08:26:01.11	2026-10-27 08:44:20.068	2026-10-29 08:26:01.118	cmvpbxqyh0000zjk42kx4d98b	UP
cmvs78pja0005zjrkj0rm1h3o	Incident Detection Test	http://www.localhost:4000	300	ACTIVE	0	2026-10-29 08:26:01.395	2026-10-28 14:17:59.11	2026-10-29 08:26:01.397	cmvpbxqyh0000zjk42kx4d98b	UP
\.


--
-- Data for Name: User; Type: TABLE DATA; Schema: public; Owner: pulsecheck
--

COPY public."User" (id, email, name, "createdAt", "updatedAt", "passwordHash") FROM stdin;
cmvpbxqyh0000zjk42kx4d98b	test@mail.com	Tester	2026-10-26 14:06:07.286	2026-10-26 14:06:21.695	MIGRATION_PLACEHOLDER_RESET_REQUIRED
\.


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: pulsecheck
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
a91e0457-4511-4946-a53a-4808ef755f29	609cb3817046359fc62b69f293e3903cd198aae0f3510bf462c59f9ad4035ff7	2026-10-23 07:51:39.309488+00	20261023075139_init	\N	\N	2026-10-23 07:51:39.299879+00	1
b567b4bc-be73-48e7-aeca-03510153472b	0cd2d226629c4d41218a41d73bd9d08773154327b5b33d728170385c4e2f2cba	2026-10-26 10:00:39.74375+00	20261026100039_add_monitors_and_check_results	\N	\N	2026-10-26 10:00:39.720376+00	1
300bf4fa-f1b4-4770-8c9c-f6415e8182eb	b3a05aea5a2a2819c8a2e84cb823184fc6a5873ad68409d436a77e74c30de38f	2026-10-27 14:37:13.210073+00	20261027143713_add_monitor_health_status	\N	\N	2026-10-27 14:37:13.196167+00	1
719a821a-7aef-4778-b04e-c9fe81a42e8b	0d16777251611ae0310412b2e36fd75553cb6ce67ece211c4d83077b7b73d5c2	2026-10-29 09:49:25.497627+00	20261029000000_add_user_password_hash	\N	\N	2026-10-29 09:49:25.485697+00	1
\.


--
-- Name: CheckResult CheckResult_pkey; Type: CONSTRAINT; Schema: public; Owner: pulsecheck
--

ALTER TABLE ONLY public."CheckResult"
    ADD CONSTRAINT "CheckResult_pkey" PRIMARY KEY (id);


--
-- Name: Monitor Monitor_pkey; Type: CONSTRAINT; Schema: public; Owner: pulsecheck
--

ALTER TABLE ONLY public."Monitor"
    ADD CONSTRAINT "Monitor_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: pulsecheck
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: pulsecheck
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: CheckResult_monitorId_checkedAt_idx; Type: INDEX; Schema: public; Owner: pulsecheck
--

CREATE INDEX "CheckResult_monitorId_checkedAt_idx" ON public."CheckResult" USING btree ("monitorId", "checkedAt");


--
-- Name: Monitor_status_idx; Type: INDEX; Schema: public; Owner: pulsecheck
--

CREATE INDEX "Monitor_status_idx" ON public."Monitor" USING btree (status);


--
-- Name: Monitor_userId_idx; Type: INDEX; Schema: public; Owner: pulsecheck
--

CREATE INDEX "Monitor_userId_idx" ON public."Monitor" USING btree ("userId");


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: pulsecheck
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: CheckResult CheckResult_monitorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pulsecheck
--

ALTER TABLE ONLY public."CheckResult"
    ADD CONSTRAINT "CheckResult_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES public."Monitor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Monitor Monitor_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pulsecheck
--

ALTER TABLE ONLY public."Monitor"
    ADD CONSTRAINT "Monitor_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict PndZRBECtJDiXZ6kP4KhjOInMgHclVsoTwjZZYtCN7FP2mHHIjAHbEWU89DTbVJ

