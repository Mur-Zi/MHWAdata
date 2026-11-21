// Hosting-only files must not be embedded in the offline app or nest APKs inside APKs.
export function isAndroidAsset(relative){
 const name=relative.replaceAll('\\','/');
 return name!=='_headers'&&!/^(updates|downloads)(\/|$)/.test(name);
}
