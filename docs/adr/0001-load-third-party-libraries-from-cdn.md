# ADR 0001: Load third-party libraries from a CDN instead of storing them in the repository

- Status: Accepted
- Date: 2026-10-25

## Context

This repository is a static site served by GitHub Pages. There is no build step, no package
manager and no bundler: every page is a plain HTML file that is served as-is.

Pages need third-party libraries (currently Chart.js for the charts in `index.html`). There are
two ways to provide them without a build step:

1. Commit a copy of the library file into the repository (e.g. a `vendor/` folder).
2. Reference the library from a public CDN with a `<script src="…">` tag.

Vendored copies bloat the repository and its history with large minified files nobody reviews,
make upgrades a manual copy-and-commit job, and are easy to forget about when security fixes
are released.

## Decision

We do not store third-party libraries in the repository. Pages load them from a CDN.

- Use cdnjs (`https://cdnjs.cloudflare.com/ajax/libs/…`) as the preferred CDN.
- Always pin an exact version in the URL (e.g. `Chart.js/4.4.1`), never a floating tag such as
  `latest` or a major-only version.
- Pages that share a library use the same version.
- Pages must not break completely if the CDN is unreachable: code that depends on the library
  checks for it first (as `index.html` does with `typeof Chart === "undefined"`), so inputs and
  numeric results still work without charts.

Our own code (page scripts, shared calculation modules, tests) stays in the repository.

## Consequences

- The repository contains only our own code; upgrades are a one-line URL change per page.
- Each page view makes a request to the CDN, which sees the visitor's IP address and the
  requested file. Apart from these pinned library files, pages make no external requests and
  include no tracking.
- The pages do not work fully offline; without network access the charts are missing.
- We depend on the CDN's availability and integrity. Adding a Subresource Integrity
  (`integrity="sha384-…"` plus `crossorigin="anonymous"`) attribute to the script tags is
  recommended as a follow-up to protect against a tampered CDN file.
