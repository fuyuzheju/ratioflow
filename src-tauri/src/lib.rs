use tauri::{Manager, Emitter};
use std::sync::Mutex;

static PENDING_FILES: Mutex<Vec<String>> = Mutex::new(Vec::new());

#[tauri::command]
fn get_pending_files() -> Vec<String> {
    std::mem::take(&mut *PENDING_FILES.lock().unwrap())
}

fn add_pending_files(paths: Vec<String>) {
    PENDING_FILES.lock().unwrap().extend(paths);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args_os()
                            .map(|oss| oss.to_string_lossy().into_owned())
                            .collect();
    add_pending_files(args[1..].to_vec());
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        add_pending_files(args[1..].to_vec());
        let _ = app.get_webview_window("main")
                   .expect("no main window")
                   .emit("open-file", ());
    }))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![get_pending_files])
    .build(tauri::generate_context!())
    .expect("error while running tauri application")
    .run(|app, event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = event {
          let files = urls
            .into_iter()
            .filter_map(|u| u.to_file_path().ok())
            .map(|url| url.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>();

            add_pending_files(files);
            let _ = app.emit("open-file", ());
        }
    })
}
