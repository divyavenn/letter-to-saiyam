If given a document, turn it into a markdown file in the letters folder, following the format of the others. Letters live in one folder per recipient, named for their page: a letter for Saiyam goes in `src/letters/saiyam/` and shows up at `/saiyam`. By default, the letter is for Saiyam.

Any images should be added to the images folder (`public/images`). An image that appears before the salutation should be used as the cover.
Any image appearing AFTER the letter itself starts should be inserted into the letter in the same place it is in the reference document.
If there is no image before the saluation, reuse one of the images in the letter itself as the cover.
If there is only one image it should be the cover. If there are multiple, the topmost one should be used as the cover.

After adding a letter, commit the letter and its associated images, then push the commit to the current branch’s remote.
