<?php
/**
 * =========================================================
 * UFRP MAIN APP ENTRY (INDEX)
 * =========================================================
 *
 * Purpose:
 * - Start PHP session
 * - Load persistent auth helper
 * - Try auto-login from remember cookie
 * - If user is not authenticated, redirect to /login.php
 *
 * IMPORTANT:
 * - This file must now be saved as: index.php
 * - Do NOT keep it as index.html if you want PHP auth to work
 */

// ---------------------------------------------------------
// SESSION START
// ---------------------------------------------------------
session_start();

// ---------------------------------------------------------
// LOAD AUTH HELPER
// ---------------------------------------------------------
require_once __DIR__ . '/auth.php';

// ---------------------------------------------------------
// TRY AUTO LOGIN FROM PERSISTENT COOKIE
// ---------------------------------------------------------
ufrp_try_auto_login();

// ---------------------------------------------------------
// IF STILL NOT LOGGED IN -> REDIRECT TO LOCAL LOGIN
// ---------------------------------------------------------
if (empty($_SESSION["UFRP_USER"]["email"])) {
  header("Location: /login.php");
  exit;
}
?>
<!doctype html>
<html lang="fa" dir="rtl">
  <head>
    <!-- =====================================================
         BASIC DOCUMENT META
         ===================================================== -->
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />

    <!-- =====================================================
         PWA META
         ===================================================== -->
    <link rel="manifest" href="/manifest.webmanifest?v=<?php echo @filemtime(__DIR__ . "/manifest.webmanifest") ?: time(); ?>">
    <meta name="theme-color" content="#ffffff" />
    <meta name="application-name" content="UFRP-IR" />
    <meta name="apple-mobile-web-app-title" content="UFRP-IR" />

    <title>سامانه ثبت تراکنش های مالی</title>

    <!-- =====================================================
         FAVICONS / APP ICONS
         ===================================================== -->
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
    <link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png">
    <link rel="icon" href="/favicon.ico">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">

    <!-- =====================================================
         MOBILE / THEME META
         ===================================================== -->
    <meta name="theme-color" content="#1e5bd7">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">

    <!-- =====================================================
         MAIN APP STYLES
         NOTE:
         - Kept functionally unchanged
         - Only reorganized with comments for readability
         ===================================================== -->
    <style>
      /* =====================================================
         GLOBAL SAFE-AREA / OVERSCROLL
         ===================================================== */
      html, body {
        overscroll-behavior: none;
      }

      body {
        padding-top: env(safe-area-inset-top);
        padding-bottom: env(safe-area-inset-bottom);
      }

      /* =====================================================
         ROOT DESIGN TOKENS
         ===================================================== */
      :root{
        --card: rgba(255,255,255,0.72);
        --card-border: rgba(0,0,0,0.06);
        --text: #111827;
        --muted: rgba(17,24,39,0.55);
        --blue: #1e5bd7;
        --shadow: 0 16px 50px rgba(0,0,0,0.10);
        --radius: 22px;
        --pad: clamp(10px, 1.4vh, 16px);
        --h1: clamp(17px, 2.2vh, 22px);
        --sub: clamp(12px, 1.6vh, 14px);
        --gap: clamp(10px, 1.4vh, 14px);
        --todayDot: #22c55e;
        --todayBorder: rgba(30,91,215,0.90);
        --todayBorderBg: rgba(30,91,215,0.06);
        --toastBg: rgba(17,24,39,0.92);
        --toastText: #ffffff;
        --menuBg: rgba(255,255,255,0.96);
        --menuBorder: rgba(17,24,39,0.10);
        --menuShadow: 0 22px 60px rgba(0,0,0,0.18);
        --activeBg: rgba(30,91,215,0.12);
        --activeBorder: rgba(30,91,215,0.20);
        --overlayBg: rgba(17,24,39,0.35);
      }

      /* =====================================================
         BASE HTML / BODY
         ===================================================== */
      html,body{
        height:100%;
        margin:0;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, "Noto Sans Arabic", "Vazirmatn", sans-serif;
        background: transparent;
        color: var(--text);
        overflow: hidden;
      }

      /* =====================================================
         MAIN PAGE WRAP
         ===================================================== */
      .wrap{
        min-height: 100vh;
        min-height: 100dvh;
        display:flex;
        align-items:flex-start;
        justify-content:center;
        padding: max(10px, env(safe-area-inset-top)) 10px max(10px, env(safe-area-inset-bottom));
        box-sizing:border-box;
      }

      .card{
        width:min(980px, 96vw);
        height: calc(100vh - 20px);
        height: calc(100dvh - 20px);
        background: var(--card);
        border: 1px solid var(--card-border);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border-radius: var(--radius);
        box-shadow: var(--shadow);
        padding: var(--pad);
        box-sizing:border-box;
        overflow: hidden;
        position: relative;
        display:flex;
        flex-direction: column;
      }

      .cardInner{
        direction: rtl;
        display:flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }

      #fixedHeaderArea{ flex: 0 0 auto; }

      #scrollArea{
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        direction: ltr;
        box-sizing: border-box;
        padding-bottom: max(18px, env(safe-area-inset-bottom));
      }

      #scrollArea > *{ direction: rtl; }

      /* =====================================================
         TOP HEADER AREA
         ===================================================== */
      .topRow{
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:12px;
        padding-top: 6px;
        padding-bottom: 10px;
        background: rgba(255,255,255,0.78);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border-bottom: 1px solid rgba(17,24,39,0.08);
        margin-bottom: 8px;
      }

      .topRightStack{
        display:flex;
        flex-direction:column;
        align-items:flex-start;
        gap:8px;
        min-width: 200px;
      }

      .fieldBadge{
        font-size: 13px;
        color: rgba(30,91,215,0.95);
        background: rgba(30,91,215,0.10);
        border: 1px solid rgba(30,91,215,0.12);
        padding: 7px 10px;
        border-radius: 999px;
        white-space:nowrap;
        font-weight: 900;
        display:inline-flex;
        align-items:center;
        gap:8px;
      }

      #titleChip{
        min-height: 42px;
        padding: 0 14px;
        border-radius: 18px;
        border: 1px solid rgba(167,139,250,0.34);
        background: rgba(237,233,254,0.96);
        box-shadow:
          0 1px 2px rgba(17,24,39,0.05),
          0 0 0 3px rgba(167,139,250,0.10);
        color: rgba(107,114,128,0.96);
        box-sizing: border-box;
        cursor: default;
      }

      #titleChip #appTitle{
        font-size: 14px;
        font-weight: 1000;
        letter-spacing: .01em;
        color: inherit;
      }

      .netDot{
        width:18px;
        height:18px;
        border-radius:6px;
        background-image:url("/favicon-48.png");
        background-position:center;
        background-repeat:no-repeat;
        background-size:cover;
        box-shadow: 0 0 0 2px rgba(255,255,255,0.85);
        flex:0 0 auto;
        filter:none;
        transition: filter 160ms ease, opacity 160ms ease, transform 160ms ease;
      }

      .fieldBadge.offline{
        color: rgba(17,24,39,0.55) !important;
        background: rgba(17,24,39,0.06) !important;
        border-color: rgba(17,24,39,0.10) !important;
      }

      .netDot.offline{
        filter: grayscale(1) saturate(0) opacity(.82);
      }

      .backBtn{
        border: 1px solid rgba(17,24,39,0.10);
        background: rgba(255,255,255,0.60);
        border-radius: 14px;
        padding: 10px 14px;
        font-size: 14px;
        cursor:pointer;
        user-select:none;
        font-weight: 900;
        white-space: nowrap;
        align-self: flex-start;
      }

      .backBtn:active{ transform: translateY(1px); }

      h1{
        margin: 6px 0 2px;
        font-size: var(--h1);
        font-weight: 900;
        text-align:center;
      }

      .sub{
        margin:0 0 6px;
        font-size: var(--sub);
        text-align:center;
        color: var(--muted);
        line-height:1.45;
      }

      /* =====================================================
         STATUS LINE / LOADING DOTS
         ===================================================== */
      .statusLine{
        display:flex;
        justify-content:center;
        align-items:center;
        gap:10px;
        margin: 10px 0 6px;
        font-size: 13px;
        color: rgba(17,24,39,0.70);
        font-weight: 800;
      }

      .dots{ display:inline-flex; gap:4px; align-items:center; }

      .dot{
        width:6px; height:6px; border-radius:999px;
        background: rgba(30,91,215,0.85);
        animation: bounce 1s infinite ease-in-out;
      }

      .dot:nth-child(2){ animation-delay: .12s; }
      .dot:nth-child(3){ animation-delay: .24s; }

      @keyframes bounce{
        0%, 80%, 100%{ transform: translateY(0); opacity:.55; }
        40%{ transform: translateY(-4px); opacity:1; }
      }

      /* =====================================================
         SECTION DIVIDERS
         ===================================================== */
      .section{
        margin-top: 14px;
        margin-bottom: 8px;
        display:flex;
        align-items:center;
        gap:10px;
      }

      .section .line{
        flex:1;
        height: 1px;
        background: rgba(30,91,215,0.22);
      }

      .section .title{
        font-weight: 900;
        font-size: 13px;
        color: rgba(30,91,215,0.95);
        background: rgba(30,91,215,0.08);
        border: 1px solid rgba(30,91,215,0.18);
        padding: 6px 10px;
        border-radius: 999px;
        white-space:nowrap;
      }

      .formSectionChip{
        grid-column: 1 / -1;
        margin-top: 10px;
        margin-bottom: 6px;
      }

      /* =====================================================
         MENU CARDS
         ===================================================== */
      .cardsGrid{
        margin-top: 10px;
        display:grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--gap);
      }

      @media (max-width: 760px){
        .cardsGrid{ grid-template-columns: 1fr; }
      }

      .formCard{
        border: 1px solid rgba(17,24,39,0.10);
        background: rgba(255,255,255,0.55);
        border-radius: 18px;
        padding: 14px;
        cursor:pointer;
        user-select:none;
        box-sizing:border-box;
      }

      .formCard:hover{
        border-color: rgba(30,91,215,0.25);
        background: rgba(30,91,215,0.06);
      }

      .formCardTitle{
        font-weight: 900;
        font-size: 14px;
        color: rgba(17,24,39,0.90);
      }

      /* =====================================================
         DYNAMIC FORM GRID
         ===================================================== */
      .gridForm{
        margin-top: 6px;
        display:grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--gap);
      }

      @media (max-width: 760px){
        .gridForm{ grid-template-columns: 1fr; }
      }

      .field{
        border: 1px solid rgba(17,24,39,0.10);
        background: rgba(255,255,255,0.55);
        border-radius: 16px;
        padding: 10px;
        box-sizing: border-box;
        position: relative;
      }

      .twoColSpan{ grid-column: 1 / -1; }

      .labelRow{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        margin-bottom: 6px;
      }

      .label{
        display:flex;
        align-items:center;
        gap:8px;
        font-weight: 900;
        font-size: 13.5px;
        color: rgba(17,24,39,0.85);
      }

      .qIcon{
        width: 18px;
        height: 18px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        opacity: .95;
        flex: 0 0 auto;
      }

      .qIcon svg{
        width: 18px;
        height: 18px;
        stroke: rgba(17,24,39,0.62);
        fill: none;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .badgeReq{
        font-size: 12px;
        color: rgba(239,68,68,0.95);
        background: rgba(239,68,68,0.10);
        border: 1px solid rgba(239,68,68,0.14);
        padding: 4px 8px;
        border-radius: 999px;
        white-space:nowrap;
        font-weight: 900;
      }

      .badgeOpt{
        font-size: 12px;
        color: rgba(17,24,39,0.75);
        background: rgba(17,24,39,0.08);
        border: 1px solid rgba(17,24,39,0.10);
        padding: 4px 8px;
        border-radius: 999px;
        white-space:nowrap;
        font-weight: 900;
      }

      .control{
        width:100%;
        box-sizing:border-box;
        border: 1px solid rgba(17,24,39,0.12);
        background: rgba(255,255,255,0.65);
        border-radius: 14px;
        padding: 10px 12px;
        font-size: 14px;
        outline: none;
      }

      .control:focus{
        border-color: rgba(30,91,215,0.35);
        box-shadow: 0 0 0 4px rgba(30,91,215,0.10);
      }

      /* =====================================================
         SEARCHABLE DROPDOWN
         ===================================================== */
      .sdWrap{ position: relative; }
      .sdInput{ padding-left: 42px; }

      .sdCaret{
        position: absolute;
        left: 10px;
        top: 50%;
        transform: translateY(-50%);
        width: 26px;
        height: 26px;
        border-radius: 12px;
        border: 1px solid rgba(17,24,39,0.10);
        background: rgba(255,255,255,0.55);
        display:flex;
        align-items:center;
        justify-content:center;
        cursor: pointer;
        user-select:none;
      }

      .sdMenu{
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        left: 0;
        background: var(--menuBg);
        border: 1px solid var(--menuBorder);
        border-radius: 16px;
        box-shadow: var(--menuShadow);
        overflow: hidden;
        z-index: 50;
        display: none;
        max-height: min(280px, 42dvh);
        flex-direction: column;
      }

      .sdMenu.show{ display: flex; }

      .sdList{
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        -webkit-overflow-scrolling: touch;
        direction: ltr;
        padding-bottom: 0 !important;
        scrollbar-width: thin;
        scrollbar-color: rgba(30,91,215,.35) rgba(17,24,39,.06);
      }

      .sdList::-webkit-scrollbar{ width: 10px; }

      .sdList::-webkit-scrollbar-track{
        background: rgba(17,24,39,.06);
        border-radius: 999px;
      }

      .sdList::-webkit-scrollbar-thumb{
        background: rgba(30,91,215,.35);
        border-radius: 999px;
        border: 2px solid rgba(17,24,39,.06);
      }

      .sdList::-webkit-scrollbar-thumb:hover{
        background: rgba(30,91,215,.50);
      }

      .sdItem, .sdEmpty{ direction: rtl; text-align: right; }

      .sdItem{
        padding: 10px 12px;
        cursor:pointer;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        font-size: 14px;
        color: rgba(17,24,39,0.92);
        border-top: 1px solid rgba(17,24,39,0.06);
        background: rgba(255,255,255,0.0);
        outline: none;
      }

      .sdItem:first-child{ border-top: 0; }
      .sdItem:hover{ background: rgba(30,91,215,0.08); }

      .sdItem.active{
        background: var(--activeBg);
        box-shadow: inset 0 0 0 1px var(--activeBorder);
      }

      .sdMark{
        font-weight: 900;
        opacity: 0;
        color: rgba(30,91,215,0.95);
        background: rgba(30,91,215,0.10);
        border: 1px solid rgba(30,91,215,0.14);
        padding: 3px 8px;
        border-radius: 999px;
        white-space:nowrap;
      }

      .sdItem.selected .sdMark{ opacity: 1; }

      .sdEmpty{
        padding: 12px;
        font-size: 13px;
        color: rgba(17,24,39,0.60);
      }

      .sdAddRow{
        flex: 0 0 auto;
        background: rgba(255,255,255,0.98);
        border-top: 1px solid rgba(17,24,39,0.08);
        padding: 8px;
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .sdAddLink{
        flex: 1 1 auto;
        font-size: 14px;
        font-weight: 900;
        color: rgba(30,91,215,0.98);
        cursor: pointer;
        user-select: none;
      }

      .sdAddInput{
        flex: 1 1 auto;
        border: 1px solid rgba(17,24,39,0.12);
        background: rgba(255,255,255,0.75);
        border-radius: 14px;
        padding: 10px 12px;
        font-size: 14px;
        outline: none;
      }

      .sdAddInput:focus{
        border-color: rgba(30,91,215,0.35);
        box-shadow: 0 0 0 4px rgba(30,91,215,0.10);
      }

      .sdAddBtn{
        width: 38px;
        height: 38px;
        border-radius: 14px;
        border: 1px solid rgba(30,91,215,0.18);
        background: rgba(30,91,215,0.10);
        color: rgba(30,91,215,0.98);
        font-weight: 900;
        cursor: pointer;
        user-select: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .sdAddBtn:active{ transform: translateY(1px); }

      /* =====================================================
         ACTION BUTTONS
         ===================================================== */
      .actions{
        margin-top: 12px;
        margin-bottom: max(16px, env(safe-area-inset-bottom));
        display:flex;
        gap: 10px;
        flex-wrap: wrap;
        justify-content:center;
      }

      .btn{
        border: 1px solid rgba(17,24,39,0.10);
        background: rgba(255,255,255,0.60);
        border-radius: 14px;
        padding: 10px 14px;
        font-size: 14px;
        cursor:pointer;
        user-select:none;
        min-width: 220px;
        font-weight: 900;
      }

      .btnPrimary{
        border-color: rgba(30,91,215,0.20);
        background: rgba(30,91,215,0.10);
        color: rgba(30,91,215,0.98);
      }

      /* =====================================================
         MODAL / PICKER
         ===================================================== */
      .modalBackdrop{
        position: fixed;
        inset: 0;
        background: var(--overlayBg);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        display: none;
        align-items: center;
        justify-content: center;
        padding: 14px;
        z-index: 9998;
      }

      .modalBackdrop.show{ display:flex; }

      .pickerCard{
        width: min(820px, 96vw);
        background: var(--card);
        border: 1px solid var(--card-border);
        border-radius: var(--radius);
        box-shadow: var(--shadow);
        padding: var(--pad);
        max-height: calc(100vh - 24px);
        max-height: calc(100dvh - 24px);
        overflow: auto;
        -webkit-overflow-scrolling: touch;
        direction: rtl;
      }

      .pickerTopRow{
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:12px;
      }

      .navBtn{
        border: 1px solid rgba(17,24,39,0.10);
        background: rgba(255,255,255,0.60);
        border-radius: 14px;
        padding: 9px 12px;
        font-size: 14px;
        cursor:pointer;
        user-select:none;
        font-weight: 900;
      }

      .navBtn:active{ transform: translateY(1px); }

      .controls{
        margin-top: 10px;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap: 10px;
        flex-wrap:wrap;
      }

      .monthTitle{
        font-size: clamp(15px, 2vh, 18px);
        font-weight: 900;
        text-align:center;
        flex:1;
        min-width: 180px;
      }

      .dropdowns{
        width:100%;
        display:flex;
        gap:10px;
        justify-content:center;
        align-items:center;
        margin-top: 6px;
        flex-wrap: nowrap;
      }

      .dropdowns select{
        width: 220px;
        max-width: 44vw;
        text-align:center;
      }

      @media (max-width: 520px){
        .dropdowns select{ width: 46vw; }
      }

      .grid{
        margin-top: 10px;
        display:grid;
        grid-template-columns: repeat(7, 1fr);
        gap: clamp(6px, 1vh, 10px);
      }

      .dow{
        font-weight:900;
        font-size: 13px;
        color: rgba(17,24,39,0.55);
        text-align:center;
        padding: 6px 0;
      }

      .day{
        position: relative;
        border: 1px solid rgba(17,24,39,0.10);
        background: rgba(255,255,255,0.55);
        border-radius: 14px;
        height: clamp(36px, 6vh, 52px);
        display:flex;
        align-items:center;
        justify-content:center;
        cursor:pointer;
        user-select:none;
        font-weight:900;
        box-sizing: border-box;
      }

      .day:hover{
        border-color: rgba(30,91,215,0.25);
        background: rgba(30,91,215,0.06);
      }

      .empty{ border: 0; background: transparent; cursor: default; }

      .todayOutline{
        border: 2px solid var(--todayBorder) !important;
        background: var(--todayBorderBg);
      }

      .todayDot::after{
        content:"";
        position:absolute;
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: var(--todayDot);
        top: 6px;
        right: 6px;
        box-shadow: 0 0 0 2px rgba(255,255,255,0.90);
      }

      /* =====================================================
         TOAST
         ===================================================== */
      .toast{
        position: fixed;
        left: 50%;
        bottom: max(14px, env(safe-area-inset-bottom));
        transform: translateX(-50%);
        background: var(--toastBg);
        color: var(--toastText);
        padding: 8px 12px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 900;
        box-shadow: 0 12px 30px rgba(0,0,0,0.20);
        opacity: 0;
        pointer-events: none;
        transition: opacity 140ms ease, transform 140ms ease;
        z-index: 9999;
        max-width: min(88vw, 520px);
        text-align: center;
      }

      .toast.show{
        opacity: 1;
        transform: translateX(-50%) translateY(-2px);
      }

      .toast.validation{
        top: 50%;
        bottom: auto;
        transform: translate(-50%, -50%) scale(.96);
        border-radius: 18px;
        padding: 16px 18px;
        font-size: 15px;
        line-height: 1.9;
        font-weight: 900;
        width: min(88vw, 420px);
        background: rgba(255,245,245,0.98);
        color: rgba(239,68,68,0.95);
        border: 1px solid rgba(239,68,68,0.18);
        box-shadow: 0 18px 46px rgba(17,24,39,0.18);
      }

      .toast.validation.show{
        transform: translate(-50%, -50%) scale(1);
      }

      /* =====================================================
         CUSTOM FILE UPLOAD
         ===================================================== */
      .fuWrap{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        width:100%;
      }

      .fuRight{
        display:flex;
        align-items:center;
        gap:10px;
        flex: 1 1 auto;
        min-width: 0;
      }

      .fuBtn{
        border: 1px solid rgba(17,24,39,0.12);
        background: rgba(255,255,255,0.65);
        border-radius: 14px;
        padding: 10px 14px;
        font-size: 14px;
        cursor:pointer;
        user-select:none;
        font-weight: 900;
        white-space: nowrap;
      }

      .fuBtn:active{ transform: translateY(1px); }

      .fuName{
        font-size: 14px;
        color: rgba(17,24,39,0.60);
        font-weight: 800;
        overflow:hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
      }

      .fuBadge{
        flex: 0 0 auto;
        font-size: 12px;
        font-weight: 900;
        padding: 4px 10px;
        border-radius: 999px;
        border: 1px solid rgba(17,24,39,0.10);
        background: rgba(17,24,39,0.06);
        color: rgba(17,24,39,0.75);
        white-space: nowrap;
      }

      .fuBadge.optional{
        background: rgba(17,24,39,0.06);
        border-color: rgba(17,24,39,0.10);
        color: rgba(17,24,39,0.70);
      }

      .fuBadge.required{
        background: rgba(239,68,68,0.10);
        border-color: rgba(239,68,68,0.14);
        color: rgba(239,68,68,0.95);
      }

      .fuNativeInput{
        position:absolute !important;
        width:1px !important;
        height:1px !important;
        padding:0 !important;
        margin:-1px !important;
        overflow:hidden !important;
        clip: rect(0, 0, 0, 0) !important;
        white-space: nowrap !important;
        border:0 !important;
      }

      /* =====================================================
         OUTBOX CHIP
         ===================================================== */
      .outboxChip{
        display:inline-flex;
        align-items:center;
        gap:0;
        padding:8px 12px;
        border-radius:999px;
        border:1px solid rgba(17,24,39,0.10);
        background:#f8fafc;
        color: rgba(30,91,215,0.92);
        font-weight:500;
        cursor:pointer;
        user-select:none;
        margin-top:6px;
        box-shadow:0 1px 2px rgba(17,24,39,0.06);
      }

      .outboxDot{
        display:none;
      }

      .outboxChip.pending{
        border-color:rgba(245,158,11,0.25);
        background:#fffbeb;
        color:#92400e;
      }

      .outboxChip.error{
        border-color:rgba(239,68,68,0.22);
        background:#fef2f2;
        color:#991b1b;
      }

      /* =====================================================
         OUTBOX PANEL
         ===================================================== */
      .outboxPanel{
        position:fixed;
        left:50%;
        transform:translateX(-50%);
        top:88px;
        bottom:auto;
        width:min(92%,520px);
        max-height:calc(100vh - 120px);
        background:#ffffff;
        border-radius:14px;
        border:1px solid rgba(17,24,39,0.10);
        box-shadow:0 10px 30px rgba(17,24,39,0.18);
        display:flex;
        flex-direction:column;
        overflow:hidden;
        z-index:99999;
      }

      .outboxPanel.hidden{
        display:none;
      }

      .outboxPanelHeader{
        display:flex;
        align-items:center;
        justify-content:space-between;
        padding:12px 16px;
        font-weight:600;
        border-bottom:1px solid rgba(17,24,39,0.08);
        background:#f8fafc;
      }

      .outboxPanelHeader button{
        border:none;
        background:transparent;
        font-size:18px;
        cursor:pointer;
        color:rgba(17,24,39,0.6);
      }

      .outboxPanelBody{
        padding:12px 16px;
        overflow-y:auto;
        overflow-x:hidden;
        max-height:50vh;
        font-size:14px;
        line-height:1.6;
        color:rgba(17,24,39,0.85);
        scrollbar-width:thin;
      }

      /* =====================================================
         APP REFRESH UI
         ===================================================== */
      .iconBtn{
        width:42px;
        height:42px;
        border-radius:14px;
        border:1px solid rgba(17,24,39,0.10);
        background: rgba(255,255,255,0.60);
        display:inline-flex;
        align-items:center;
        justify-content:center;
        cursor:pointer;
        user-select:none;
        flex:0 0 auto;
      }

      .iconBtn:active{ transform: translateY(1px); }

      .iconBtn svg{
        width:20px;
        height:20px;
        stroke: rgba(17,24,39,0.72);
        fill:none;
        stroke-width:2;
        stroke-linecap:round;
        stroke-linejoin:round;
      }

      .topLeftActions{
        display:flex;
        align-items:center;
        gap:8px;
        flex:0 0 auto;
      }

      .desktopRefreshBtn{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        gap:8px;
        height:42px;
        padding:0 14px;
        border-radius:999px;
        border:1px solid rgba(17,24,39,0.10);
        background: rgba(255,255,255,0.60);
        box-shadow:0 1px 2px rgba(17,24,39,0.06);
        color: rgba(17,24,39,0.88);
        font-size:13px;
        font-weight:900;
        white-space:nowrap;
        width:auto;
        min-width:auto;
        cursor:pointer;
        user-select:none;
        transition:
          background 140ms ease,
          border-color 140ms ease,
          color 140ms ease,
          box-shadow 140ms ease,
          transform 140ms ease;
      }

      .desktopRefreshBtn:hover{
        border-color: rgba(30,91,215,0.25);
        background: rgba(30,91,215,0.06);
        color: rgba(17,24,39,0.92);
      }

      .desktopRefreshBtn:active{
        transform: translateY(1px);
      }

      .desktopRefreshBtn:focus-visible{
        outline:none;
        border-color: rgba(30,91,215,0.30);
        box-shadow:
          0 1px 2px rgba(17,24,39,0.06),
          0 0 0 4px rgba(30,91,215,0.10);
      }

      .desktopRefreshBtn svg{
        width:17px;
        height:17px;
        stroke: currentColor;
        fill:none;
        stroke-width:2;
        stroke-linecap:round;
        stroke-linejoin:round;
      }

      .topUtilityStack{
        display:flex;
        flex-direction:column;
        align-items:flex-end;
        gap:8px;
        flex:0 0 auto;
      }

      .prefetchChip{
        display:inline-flex;
        align-items:center;
        justify-content:flex-start;
        gap:8px;
        min-height:34px;
        padding:7px 12px;
        border-radius:999px;
        border:1px solid rgba(17,24,39,0.10);
        background:#f8fafc;
        box-shadow:0 1px 2px rgba(17,24,39,0.06);
        color: rgba(17,24,39,0.55);
        font-size:12px;
        font-weight:800;
        line-height:1.45;
        white-space:normal;
        text-align:right;
        direction:rtl;
        width:fit-content;
        max-width:min(88vw, 340px);
        box-sizing:border-box;
      }

      .prefetchChip.done{
        border-color: rgba(17,24,39,0.10);
        background:#f8fafc;
        box-shadow:0 1px 2px rgba(17,24,39,0.06);
        color: rgba(17,24,39,0.55);
      }

      .prefetchChip.error{
        border-color: rgba(17,24,39,0.10);
        background:#f8fafc;
        box-shadow:0 1px 2px rgba(17,24,39,0.06);
        color: rgba(17,24,39,0.55);
      }

      @media (hover: none), (pointer: coarse) {
        .desktopRefreshBtn{
          display:none !important;
        }
      }

      .pullRefreshHint{
        position: sticky;
        top: 8px;
        left: 50%;
        right: auto;
        z-index: 5;
        margin: 0 0 10px;
        width: 54px;
        height: 54px;
        border-radius: 999px;
        border: 1px solid rgba(30,91,215,0.14);
        background: rgba(255,255,255,0.92);
        color: rgba(30,91,215,0.94);
        box-shadow: 0 12px 28px rgba(17,24,39,0.10);
        display: none;
        align-items: center;
        justify-content: center;
        opacity: .78;
        transform: translateX(-50%) translateY(-6px) scale(.92);
        transition: opacity 140ms ease, transform 140ms ease, border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
        pointer-events: none;
      }

      .pullRefreshHint.show{
        display: inline-flex;
        animation: pullHintFloat 1.05s ease-in-out infinite;
      }

      .pullRefreshHint.ready{
        opacity: 1;
        transform: translateX(-50%) translateY(0) scale(1.04);
        border-color: rgba(30,91,215,0.26);
        background: rgba(255,255,255,0.99);
        box-shadow: 0 14px 34px rgba(30,91,215,0.14);
        animation: pullHintReady 0.75s ease-in-out infinite;
      }

      .pullRefreshHint svg{
        width: 24px;
        height: 24px;
        stroke: currentColor;
        fill: none;
        stroke-width: 2.2;
        stroke-linecap: round;
        stroke-linejoin: round;
        opacity: .96;
      }

      @keyframes pullHintFloat{
        0%, 100%{
          transform: translateX(-50%) translateY(-6px) scale(.92);
        }
        50%{
          transform: translateX(-50%) translateY(0) scale(.98);
        }
      }

      @keyframes pullHintReady{
        0%, 100%{
          transform: translateX(-50%) translateY(0) scale(1.04);
        }
        50%{
          transform: translateX(-50%) translateY(3px) scale(1.08);
        }
      }

      .refreshModalCard{
        width:min(460px, 94vw);
        background: var(--card);
        border: 1px solid var(--card-border);
        border-radius: var(--radius);
        box-shadow: var(--shadow);
        padding: var(--pad);
        direction: rtl;
      }

      .refreshModalActions{
        margin-top: 14px;
        display:flex;
        gap:10px;
        flex-wrap:wrap;
        justify-content:center;
      }
    </style>
  </head>

  <body>
    <!-- =====================================================
         MAIN APP WRAPPER
         ===================================================== -->
    <div class="wrap">
      <div class="card" id="mainCard">
        <div class="cardInner">

          <!-- =================================================
               FIXED HEADER AREA
               ================================================= -->
          <div id="fixedHeaderArea">
            <div class="topRow">
              <div class="topRightStack">
                <div class="fieldBadge" id="titleChip">
                  <span class="netDot" id="netDot" aria-hidden="true"></span>
                  <span id="appTitle">سامانه ثبت تراکنش های مالی</span>
                </div>

                <div class="sub" style="text-align:right; margin:0;">
                  <span id="userFullName"></span>
                </div>

                <div id="prefetchChip"
                     class="prefetchChip"
                     style="display:none;"
                     aria-live="polite">
                  <span id="prefetchText">در حال آماده‌سازی فرم‌ها</span>
                </div>

                <button id="outboxChip"
                        class="outboxChip"
                        type="button"
                        style="display:none"
                        title="Background submissions">
                  <span class="outboxDot" aria-hidden="true"></span>
                  <span id="outboxText">Outbox</span>
                </button>
              </div>

              <div class="topLeftActions">
                <div class="topUtilityStack">
                  <button
                    id="refreshAppBtn"
                    class="desktopRefreshBtn"
                    type="button"
                    title="بروزرسانی کامل برنامه"
                    aria-label="بروزرسانی کامل برنامه"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M21 12a9 9 0 1 1-2.64-6.36"></path>
                      <path d="M21 3v6h-6"></path>
                    </svg>
                    <span>بروزرسانی کامل برنامه</span>
                  </button>
                </div>

                <button class="backBtn"
                        id="backBtn"
                        type="button"
                        onclick="backToMenu()"
                        style="display:none;">
                  بازگشت
                </button>
              </div>
            </div>

            <!-- STATUS LINE -->
            <div class="statusLine" id="statusLine" style="display:none;">
              <span id="statusText">در حال بارگذاری</span>
              <span class="dots" id="statusDots" aria-hidden="true">
                <span class="dot"></span><span class="dot"></span><span class="dot"></span>
              </span>
            </div>

            <!-- STATIC FORM HEADER -->
            <div id="formStaticHeader" style="display:none;">
              <h1 id="formTitle">—</h1>
              <p class="sub" id="formSubtitle">—</p>

              <div id="formChipRow">
                <div class="section">
                  <div class="line"></div>
                  <div class="title">فرم</div>
                  <div class="line"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- =================================================
               SCROLLABLE APP CONTENT
               ================================================= -->
          <div id="scrollArea">
            <div id="pullRefreshHint" class="pullRefreshHint" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 5v10"></path>
                <path d="M7 11l5 5 5-5"></path>
              </svg>
            </div>

            <div id="menuView">
              <div id="menuContainer"></div>
            </div>

            <div id="formView" style="display:none;">
              <div class="formShellBody" id="formShellBody"></div>
            </div>
          </div>

        </div>
      </div>
    </div>

    <!-- =====================================================
         OUTBOX PANEL
         ===================================================== -->
    <div id="outboxPanel" class="outboxPanel hidden">
      <div class="outboxPanelHeader">
        <span>صف ارسال</span>
        <button id="outboxPanelClose" type="button">✕</button>
      </div>

      <div id="outboxPanelBody" class="outboxPanelBody"></div>
    </div>

    <div id="appRefreshModal" class="modalBackdrop" aria-hidden="true">
      <div class="refreshModalCard" role="dialog" aria-modal="true" aria-labelledby="appRefreshModalTitle">
        <div style="text-align:center; font-weight:900; font-size: clamp(16px,2.2vh,20px);" id="appRefreshModalTitle">
          بروزرسانی برنامه
        </div>

        <p style="margin:10px 0 0; text-align:center; color: var(--muted); font-size:13px; line-height:1.8;">
          آیا می‌خواهید کل برنامه بروزرسانی شود؟
        </p>

        <div class="refreshModalActions">
          <button class="btn btnPrimary" type="button" id="appRefreshConfirmBtn">بله، بروزرسانی شود</button>
          <button class="btn" type="button" id="appRefreshCancelBtn">انصراف</button>
        </div>
      </div>
    </div>

    <!-- =====================================================
         JALALI DATE PICKER MODAL
         ===================================================== -->
    <div class="modalBackdrop" id="pickerModal" aria-hidden="true">
      <div class="pickerCard" role="dialog" aria-modal="true" aria-label="Jalali date picker">
        <div class="pickerTopRow">
          <div class="fieldBadge" id="pickerBadge">انتخاب تاریخ</div>
          <button class="navBtn" type="button" onclick="closePicker()">بستن</button>
        </div>

        <div style="text-align:center; margin-top:8px; font-weight:900; font-size: clamp(16px,2.2vh,20px);">
          انتخاب تاریخ شمسی
        </div>

        <p style="margin:0; text-align:center; color: var(--muted); font-size:13px; line-height:1.45;">
          روی یک روز بزنید تا تاریخ انتخاب شود.
        </p>

        <div class="controls">
          <button class="navBtn" id="nextBtn" type="button">ماه بعد</button>
          <div class="monthTitle" id="monthTitle">—</div>
          <button class="navBtn" id="prevBtn" type="button">ماه قبل</button>

          <div class="dropdowns">
            <select class="control" id="yearSelect" aria-label="سال"></select>
            <select class="control" id="monthSelect" aria-label="ماه"></select>
          </div>
        </div>

        <div class="grid" id="grid"></div>

        <div style="margin-top: 10px; display:flex; gap: 10px; justify-content:center; flex-wrap:wrap;">
          <button class="btn" type="button" onclick="goPickerToday()">امروز</button>
        </div>
      </div>
    </div>

    <!-- =====================================================
         TOAST
         ===================================================== -->
    <div class="toast" id="toast">✅ انجام شد</div>

    <!-- =====================================================
         SERVICE WORKER APP-SHELL CACHE
         ===================================================== -->
    <script>
      if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => {
          navigator.serviceWorker.register("/sw.js")
            .then((reg) => {
              console.log("SW registered ✅", reg.scope || "");
              try { reg.update(); } catch (_) {}
            })
            .catch((err) => {
              console.warn("SW registration failed:", err);
            });
        });
      }
    </script>

    <!-- =====================================================
         QUERY PARAM BOOTSTRAP
         ===================================================== -->
    <script>
      (function(){
        const params = new URLSearchParams(location.search);
        window.__INITIAL_VIEW__ = params.get("view") || "app";
        window.__INITIAL_FORM_KEY__ = params.get("formKey") || "";
      })();
    </script>

    <!-- =====================================================
         MAIN CLIENT SCRIPTS
         NOTE:
         - Paths kept unchanged
         ===================================================== -->
    <script>
/**
 * =========================================================
 * UFRP USER CONTEXT INJECTION
 * =========================================================
 * Pass logged-in user email from PHP → JavaScript
 */

window.__UFRP_USER_EMAIL__ = <?php
  echo json_encode($_SESSION["UFRP_USER"]["email"] ?? "");
?>;
</script>

    
         <script src="/client.js?v=<?php echo @filemtime(__DIR__ . "/client.js") ?: time(); ?>"></script>
    <script src="/client-offline.js?v=<?php echo @filemtime(__DIR__ . "/client-offline.js") ?: time(); ?>"></script>

    <!-- =====================================================
         RUNTIME ERROR CAPTURE
         ===================================================== -->
    <script>
      window.addEventListener("error", function (e) {
        try {
          const line = document.getElementById("statusLine");
          const txt  = document.getElementById("statusText");
          if (line && txt) {
            txt.textContent =
              "خطای اجرا: " +
              String(e && e.message ? e.message : "unknown") +
              " | " +
              String(e && e.filename ? e.filename.split("/").slice(-1)[0] : "inline") +
              ":" +
              String(e && e.lineno ? e.lineno : 0);
            line.style.display = "flex";
          }
        } catch (_) {}
      });

      window.addEventListener("unhandledrejection", function (e) {
        try {
          const line = document.getElementById("statusLine");
          const txt  = document.getElementById("statusText");
          const reason = e && e.reason;
          const msg =
            typeof reason === "string"
              ? reason
              : String((reason && reason.message) || reason || "promise rejection");

          if (line && txt) {
            txt.textContent = "خطای اجرا: " + msg;
            line.style.display = "flex";
          }
        } catch (_) {}
      });
    </script>

    <!-- =====================================================
         APP BOOTSTRAP / DEBUG
         ===================================================== -->
    <script>
      console.log("INDEX after client scripts → __CLIENT_LOADED__:", !!window.__CLIENT_LOADED__);
      console.log("UFRP INDEX LOADED ✅", new Date().toISOString());
      window.__UFRP_INDEX_MARK__ = "INDEX_OK";

      document.addEventListener("DOMContentLoaded", () => {
        try{
          if (typeof window.appInit === "function") {
            window.appInit();
          } else {
            console.error("appInit is not defined. client.js did not load.");
            const line = document.getElementById("statusLine");
            const txt  = document.getElementById("statusText");

            if (line && txt){
              txt.textContent = "خطای داخلی: اسکریپت کلاینت لود نشد";
              line.style.display = "flex";
            }
          }
        }catch(e){
          console.error(e);
        }
      });

      /* ===================================================
         MOUSE WHEEL REDIRECT TO INTERNAL SCROLL AREA
         =================================================== */
      (function(){
        const scrollArea = document.getElementById("scrollArea");

        window.addEventListener("wheel", (e) => {
          if (!scrollArea) return;
          if (e.target && scrollArea.contains(e.target)) return;

          const maxScroll = scrollArea.scrollHeight - scrollArea.clientHeight;
          if (maxScroll <= 0) return;

          e.preventDefault();
          scrollArea.scrollTop = Math.max(
            0,
            Math.min(maxScroll, scrollArea.scrollTop + e.deltaY)
          );
        }, { passive: false });
      })();
    </script>
  </body>
</html>