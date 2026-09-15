# Open decisions

What is waiting on Lakshya, what is parked, and what shipped. Kept here rather
than on the Desktop: that folder is a OneDrive symlink, and files in it cannot
always be read from a terminal. Nothing in this folder is published with the
site — only the built pages are.

Last updated: 12 September 2026.

## Waiting on you

- **Switch labels.** The pages can be shown as "Page thumbnails" or "Read
  through". Do those read right, or would something else be clearer?
- **GitHub username.** Renaming the account means the repository URL changes;
  worth doing in one go, whenever you want it.

## Settled

- **Hindi wording — approved 12 September 2026.** अनुलग्नक (Annexure),
  प्रदर्श (Exhibit), प्रमाणित सत्य प्रतिलिपि (Certified True Copy),
  गोपनीय (Confidential), बिना किसी पूर्वाग्रह के (Without Prejudice),
  मसौदा (Draft), केवल सत्यापन हेतु (For Verification Only), पृष्ठ (Page).
- **Mixed passwords.** When files locked with different passwords are merged,
  the panel offers a choice of which file's password protects the saved copy,
  defaulting to the first.
- **A protected file keeps its password** unless "Change" or "Remove" is chosen.

## Parked

- **Remove the password from the password prompt.** A switch there that removes
  the password once the correct one is typed; it can be changed in the main
  password tool, but if chosen it becomes the default. Its wording needs
  refreshing too.
- **Scan photos** (auto-crop and clearer text) is built on the local
  `scan-photos` branch; it needs testing on real phone photos first.
- **OCR on a scan that is sideways inside the file.** The reader expects
  upright text.

- **Signatures.** The panel and its placing view exist but are switched off:
  placement and background removal are not good enough yet. When it comes back
  it should use the placing view and dragging, like everything else.
- **Terms and disclaimer** pages.
- **Redlining** two documents against each other.
- **Dragging pages to reorder on a phone**, which is fiddly today.

## Shipped, 15 September 2026

- **PDF scan and OCR:** English only, read on the device with Tesseract served
  from the site itself. Words are laid over each scanned page as invisible text,
  so they can be searched, selected and copied; the page looks exactly the same.
  Pages with text are left alone, and words a scan already carries (such as a
  page number) are not added twice. Also in Control Room.

## Shipped, 12 September 2026

- **Add text on pages** (was "Label pages"): type anything, or number it
  automatically (Annexure P-1 to P-4), eight fonts, colour, box, and a placing
  view that shows the page exactly as it prints.
- **The same treatment across the tools:** page numbers placed, dragged and
  hidden the same way, in i/I styles, able to start after a cover page; the
  watermark previewed truly and left off single pages; redaction boxes moved
  and resized; bookmarks numbered like text and renamed with a button.
- **Adding from the page itself:** "+ Add to this page" offers text, page
  numbers or a watermark, and tapping blank paper offers "Add text here".
- **Passwords are an explicit choice:** keep, change or remove.
- **Search steps with Enter** and says where you are ("3 of 24").
- **Read through:** full-size pages in a scrolling column, with zoom.
- **A few words in Hindi**, picked from a list rather than typed.
- **File name and download:** the name is filled in and editable, with a
  download button beside it.
