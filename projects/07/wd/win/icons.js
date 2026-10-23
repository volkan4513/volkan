// Widget Desktop - desktop icons. They are cut out of
// references/win_icon_sheet.jpg by tools/make_win_icons.py into one strip,
// wd/win/icons.webp; keep this list in the same order as NAMES there.
'use strict';
const WICONS = ('explorer browser notepad paint photos calculator clock settings widgets info home pc recycle desktop documents '
    + 'downloads music folder file text code newfolder newfile upload download rename delete restore broom view search back '
    + 'forward up refresh house undo redo lock star link mail gear-folder tree zoom-in zoom-out open save print help').split(' ');
document.documentElement.style.setProperty('--wico-n', WICONS.length);
// an icon as HTML; it is 1em square, so font-size sets its size
const wico = name => { const i = WICONS.indexOf(name); return i < 0 ? '' : `<span class="wico" style="--i:${i}" aria-hidden="true"></span>`; };
