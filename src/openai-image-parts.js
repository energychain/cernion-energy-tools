'use strict';

// A chat client sends a pasted screenshot as an image part of the user's message (OpenAI
// `image_url` with a data URL). The text normalisation keeps only text parts, so the image used to
// vanish. The images of the current message become originals in the file channel, like attached
// files, and are read from there (transcript, deduplication, document context).
const MAX_IMAGES = 8;
const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/u;
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function latestUserMessage(rawMessages) {
  return [...(Array.isArray(rawMessages) ? rawMessages : [])]
    .reverse()
    .find((message) => message?.role === 'user');
}

// Only inline images are taken; a remote URL is never fetched.
function imageParts(rawMessages) {
  const content = latestUserMessage(rawMessages)?.content;
  if (!Array.isArray(content)) return [];
  return content
    .map((part) => {
      const url = part?.type === 'image_url' ? part.image_url?.url || part.image_url : null;
      const match = typeof url === 'string' ? url.match(DATA_URL) : null;
      return match ? { mimeType: match[1], contentBase64: match[2] } : null;
    })
    .filter(Boolean)
    .slice(0, MAX_IMAGES);
}

async function storeImageParts(ctx, rawMessages, identity) {
  const refs = [];
  for (const [index, image] of imageParts(rawMessages).entries()) {
    const stored = await ctx.call(
      'files.upload',
      {
        name: `bild-${index + 1}.${EXTENSIONS[image.mimeType]}`,
        contentBase64: image.contentBase64,
        mimeType: image.mimeType,
        ...(identity.openWebuiOrgId ? { openWebuiOrgId: identity.openWebuiOrgId } : {}),
        ...(identity.openWebuiUserId ? { openWebuiUserId: identity.openWebuiUserId } : {}),
      },
      { meta: ctx.meta }
    );
    refs.push({
      fileId: stored.fileId,
      name: stored.name,
      mimeType: stored.mimeType,
      size: stored.size,
      hash: stored.hash,
    });
  }
  return refs;
}

module.exports = { imageParts, storeImageParts };
