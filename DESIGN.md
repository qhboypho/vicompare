---
version: "alpha"
name: ViCompare Production Console
description: Dense dark-mode workspace for generating, previewing, rendering, and publishing short comparison videos.
colors:
  primary: "#6366F1"
  primary-hover: "#4F46E5"
  primary-soft: "rgba(99, 102, 241, 0.15)"
  canvas: "#090D16"
  panel: "#0B0F19"
  panel-raised: "#0F172A"
  surface: "rgba(30, 41, 59, 0.70)"
  surface-hover: "rgba(30, 41, 59, 0.95)"
  border: "rgba(148, 163, 184, 0.10)"
  border-strong: "#334155"
  text: "#F8FAFC"
  text-inverse: "#FFFFFF"
  text-secondary: "#94A3B8"
  text-muted: "#64748B"
  success: "#10B981"
  warning: "#F59E0B"
  danger: "#EF4444"
  facebook: "#1877F2"
  youtube: "#FF0000"
  tiktok: "#00F2FE"
typography:
  display:
    fontFamily: "Montserrat"
    fontSize: "1.25rem"
    fontWeight: "800"
    lineHeight: "1.15"
    letterSpacing: "-0.025em"
  section-title:
    fontFamily: "Montserrat"
    fontSize: "0.95rem"
    fontWeight: "700"
    lineHeight: "1.25"
    letterSpacing: "0em"
  tab-label:
    fontFamily: "Montserrat"
    fontSize: "0.90rem"
    fontWeight: "700"
    lineHeight: "1.2"
    letterSpacing: "0.05em"
  body:
    fontFamily: "Inter"
    fontSize: "0.85rem"
    fontWeight: "400"
    lineHeight: "1.45"
    letterSpacing: "0em"
  label:
    fontFamily: "Inter"
    fontSize: "0.75rem"
    fontWeight: "600"
    lineHeight: "1.25"
    letterSpacing: "0.05em"
  compact:
    fontFamily: "Inter"
    fontSize: "0.65rem"
    fontWeight: "500"
    lineHeight: "1.3"
    letterSpacing: "0em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: "500"
    lineHeight: "1.35"
    letterSpacing: "0em"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  panel: "1.25rem"
components:
  app-shell:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.text}"
  header:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.text}"
    height: "60px"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    padding: "{spacing.panel}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "{spacing.panel}"
  button-primary:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.text-inverse}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  button-secondary:
    backgroundColor: "#1E293B"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  preview-canvas:
    backgroundColor: "#000000"
    rounded: "{rounded.xl}"
    width: "290px"
  timeline-row:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "6px 8px"
---

## Overview

ViCompare is a compact production console for repeated video work: script intake, pose and subtitle timing, AI voice, visual settings, render preview, and social publishing. The interface should feel like a focused editing cockpit rather than a marketing website.

The design density is high by default. The 9:16 preview is the anchor on the left, the active editor occupies the center, and supporting script or automation panels sit on the right. Every screen should favor speed, scanability, and predictable controls over decorative presentation.

## Colors

The product uses a dark slate workspace with one main indigo action color.

- **Canvas (#090D16):** App background and scrollbar track.
- **Panel (#0B0F19):** Preview column, script sidebar, form inputs, tables, and dense nested work areas.
- **Panel Raised (#0F172A):** Header, popovers, modals, and high-priority surfaces.
- **Surface (rgba(30, 41, 59, 0.70)):** Glass cards and grouped tool panels.
- **Primary Indigo (#6366F1):** Primary buttons, active tab underline, focus rings, selected timeline rows, and important action affordances.
- **Text (#F8FAFC):** Primary text.
- **Secondary Text (#94A3B8):** Labels, descriptions, helper text, disabled explanations, and metadata.
- **Muted Text (#64748B):** IDs, low-priority counters, empty state text.
- **Success (#10B981), Warning (#F59E0B), Danger (#EF4444):** Status-only accents.
- **Platform Colors:** Facebook `#1877F2`, YouTube `#FF0000`, TikTok `#00F2FE`. Use these only inside account cards, platform badges, and publish status rows.

Avoid adding new dominant hues. Gradients are allowed only in tiny brand/header moments or render-progress fills; do not use gradients as page backgrounds or large decorative shapes.

## Typography

Use `Montserrat` for product identity, tab labels, and compact section headers. Use `Inter` for all form controls, tables, body copy, status text, and operational UI.

Typography should stay compact:

- App title: `1.25rem`, `800`, `Montserrat`, tight tracking.
- Card title: `0.95rem`, `700`, `Montserrat`.
- Tab labels: `0.9rem`, uppercase, `0.05em` tracking.
- Body/control text: `0.85rem`, `Inter`.
- Labels: `0.75rem`, uppercase, `0.05em` tracking.
- Microcopy and IDs: `0.55rem` to `0.70rem`; use ellipsis rather than wrapping long IDs.
- Monospace is reserved for timestamps, IDs, technical logs, and script/code-like values.

Do not introduce hero-scale type inside tool panels. Headings inside cards must stay small and proportional to dense controls.

## Layout

The core desktop layout is a three-column workspace:

- Left preview panel: fixed `360px`, dark panel, centered 9:16 canvas with playback controls below.
- Center editor panel: flexible column for the active workflow tab.
- Right script panel: fixed `380px`, used for dialogue script and helper actions.

Below `1200px`, collapse to two columns. Below `768px`, collapse to one column with vertical scroll. Never allow horizontal page overflow on mobile.

Use CSS grid for stable tool surfaces: comparison pairs, social account cards, timeline rows, pose grids, and publish settings. Use flex for simple alignment inside a single row. Fixed-format elements need stable dimensions: timeline cells, icon buttons, canvas containers, compact account rows, and modal action bars must not resize when labels or IDs change.

## Elevation & Depth

Depth is restrained and functional:

- Cards use translucent slate surfaces with a 1px low-contrast border.
- The main canvas can use stronger shadow because it is the visual output artifact.
- Modals use dark overlays with blur and a raised panel.
- Popovers use `#0F172A`, a 1px border, and a compact shadow.
- Do not nest cards inside cards. If a tool needs grouping inside a card, use borders, dividers, or tinted rows instead.

Glow is limited to selected/focused states. Keep glows tight and low-opacity; avoid large neon halos.

## Shapes

The UI is compact and slightly rounded:

- Inputs and standard buttons: `6px`.
- Small buttons and chips: `4px`.
- Account cards, pose cards, player controls: `8px`.
- Glass cards and larger grouped panels: `12px`.
- Canvas/export previews and render modal cards: `16px`.

Do not increase radius to pill shapes except for circular play buttons, avatar-like platform icons, and range slider thumbs.

## Components

**Buttons:** Primary buttons are indigo with white text. Secondary buttons are slate with a thin border. Danger buttons use red only for destructive actions. Buttons should include lucide icons when the command benefits from a recognizable symbol. Keep toolbar buttons compact.

**Tabs:** Tabs are uppercase `Montserrat`, active state is indigo text plus a 2px underline. Tabs should sit on a simple bottom border, not inside floating cards.

**Cards:** Use `.glass-card` for top-level workflow groups, modals, and repeated account/platform cards. Cards should not become marketing tiles. Keep padding at `1.25rem` for major panels and reduce padding for dense repeated rows.

**Inputs:** Labels sit above inputs. Inputs use `#0B0F19`, 1px low-contrast border, and indigo focus ring. Long technical values must support copy buttons, hidden secret toggles, or ellipsis where appropriate.

**Timeline Rows:** Rows are dense grid tracks with fixed time columns, flexible text, mascot expression select, highlight select, and an icon delete button. Active rows use indigo border and `primary-soft` fill.

**Preview Canvas:** The canvas remains a first-class artifact. Keep its 9:16 aspect ratio, stable max width, rounded corners, and clear separation from player controls.

**Social Account Cards:** Keep cards compact. Use platform color as a border or icon accent, not a full-card fill. Account selection uses checkboxes; visible names are more important than raw IDs. IDs may appear as secondary muted text.

**Modals:** Use focused, scrollable panels with max height `90vh`. Keep form sections separated by thin dividers. Modal action buttons sit in a two-column footer.

**Loading and Progress:** Use progress bars, inline status text, and exact operation names. Avoid generic full-screen spinners unless the operation blocks the whole app.

## Do's and Don'ts

Do:

- Preserve the dark production-console feel.
- Keep operational controls compact and predictable.
- Favor dense but readable layouts over decorative whitespace.
- Use platform colors only where they identify a platform.
- Use exact status messages for render, voice, upload, and publish operations.
- Keep text within containers using ellipsis, wrapping, or smaller microcopy.
- Maintain the preview canvas as the primary visual reference.

Don't:

- Do not create a landing-page hero inside this app.
- Do not add decorative blobs, gradient orbs, bokeh, or background illustrations.
- Do not use one-note purple gradients across whole sections.
- Do not put cards inside cards.
- Do not add oversized headings inside dashboards or modals.
- Do not hide account identity behind IDs only; show page/channel/account names first.
- Do not use custom cursors or playful decorative animation.
- Do not animate layout dimensions; animate transform and opacity only.
- Do not let mobile layouts overflow horizontally.
