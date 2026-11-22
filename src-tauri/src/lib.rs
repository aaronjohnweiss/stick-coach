mod adapter;

use adapter::Adapter;
use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
fn adapter_start(app: AppHandle, adapter: State<Adapter>) -> Result<(), String> {
    adapter.start(app)
}

#[tauri::command]
fn adapter_stop(adapter: State<Adapter>) {
    adapter.stop();
}

const GUIDE: &str = "https://github.com/PhobGCC/PhobGCC-doc/blob/main/For_Users/Phob_Calibration_Guide_Latest.md";
const DOCS: &str = "https://github.com/PhobGCC/PhobGCC-doc";

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .manage(Adapter::default())
        .invoke_handler(tauri::generate_handler![adapter_start, adapter_stop])
        .setup(|app| {
            let guide = MenuItem::with_id(app, "guide", "PhobGCC calibration guide (latest)", true, None::<&str>)?;
            let docs = MenuItem::with_id(app, "docs", "PhobGCC documentation", true, None::<&str>)?;
            let file = SubmenuBuilder::new(app, "File").quit().build()?;
            let help = SubmenuBuilder::new(app, "Help").item(&guide).item(&docs).build()?;
            let menu = MenuBuilder::new(app).items(&[&file, &help]).build()?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let url = match event.id().as_ref() {
                "guide" => GUIDE,
                "docs" => DOCS,
                _ => return,
            };
            let _ = app.opener().open_url(url, None::<&str>);
        })
        .build(tauri::generate_context!())
        .expect("error building Stick Coach")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<Adapter>().stop();
            }
        });
}
