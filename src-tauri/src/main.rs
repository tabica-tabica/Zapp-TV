// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // WebKitGTK: o sink GL do GStreamer derruba o WebProcess (SIGBUS em
  // gst_gl_memory_read_pixels, Mesa radeonsi) ao tocar a prévia ao vivo da
  // Home. Sem o sink GL o vídeo vai pelo caminho de software. Respeita quem
  // já definiu a variável na mão.
  #[cfg(target_os = "linux")]
  if std::env::var_os("WEBKIT_GST_DISABLE_GL_SINK").is_none() {
    std::env::set_var("WEBKIT_GST_DISABLE_GL_SINK", "1");
  }
  app_lib::run();
}
