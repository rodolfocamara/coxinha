# ADR-0024: Meeting titles from a user-owned LLM over SSH

- Date: 2026-10-31
- Status: Accepted (requested by the owner on 2026-10-31 with spec 0097 P4)

## Context

ADR 0021 item 8 and spec 0089 say that no captured content leaves the
computer. The owner wants automatic titles from the Qwen endpoint they run on
their own Mac on the local network (`macserver@192.168.15.66`). That host
serves an OpenAI-compatible API bound to `127.0.0.1:8000` and is reached
through SSH. Nothing like Ollama runs on the laptop.

## Decision

An opt-in, default-off setting lets Coxinha send transcript excerpts to one
user-owned host, only through an SSH local forward and only to generate a
meeting title.

1. Only text leaves, never audio: at most 1500 tokens of transcript per
   request (the first 5 minutes, then a sample at the end). Nothing else is
   sent.
2. The transport is the system `ssh` client in stdio mode (`-W`), with
   `BatchMode`, no ControlMaster, strict host keys and a connect timeout.
   It is opened per request and killed after it; no local port is opened. Keys and host trust are the
   user's SSH configuration; Coxinha stores no credential.
3. The target, the remote port and the model are visible in Ajustes ›
   Integrações. Turning it off stops every request immediately.
4. The result is a Memory suggestion (ADR 0015) with its source, shown as
   "título sugerido" with Desfazer. It replaces only the automatic
   placeholder, never a title the user typed.
5. Failures leave the placeholder title. There is no fallback to any other
   host or cloud service.

This amends ADR 0021 item 8 and spec 0089 (and applies ADR 0015) ("no captured content leaves the
computer") for this setting only. Audio, ASR and diarization stay local.

## Consequences

- **+** Good titles without installing an LLM on the laptop.
- **+** Encrypted transport to a machine the owner controls.
- **−** Transcript excerpts exist briefly on the Mac. Their retention there
  depends on that server's own logging (rapid-mlx); Coxinha cannot control
  it.
- **−** It needs the LAN, and SSH without a prompt. On a network where the
  Mac is unreachable, meetings keep their placeholder titles.
