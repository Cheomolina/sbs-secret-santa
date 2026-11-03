import { supabase } from './supabase';

// Shrinks the picture in the browser (max 800px, JPEG) before upload to keep storage small.
async function resize(file, max = 800) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not process image'))), 'image/jpeg', 0.85));
}

export async function uploadImage(file, path) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file');
  const blob = await resize(file);
  const { error } = await supabase.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return supabase.storage.from('photos').getPublicUrl(path).data.publicUrl;
}

export async function removeImageByUrl(url) {
  const marker = '/photos/';
  const i = url?.indexOf(marker) ?? -1;
  if (i < 0) return;
  await supabase.storage.from('photos').remove([decodeURIComponent(url.slice(i + marker.length))]);
}
