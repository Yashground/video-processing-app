let youtubeApiLoaded = false;

export function loadYouTubeIframeAPI(): Promise<void> {
  if (youtubeApiLoaded) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    window.onYouTubeIframeAPIReady = () => {
      youtubeApiLoaded = true;
      resolve();
    };
  });
}
