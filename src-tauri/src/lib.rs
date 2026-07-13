use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

const KEY_FILE: &str = "anthropic_key.secret.json";

fn key_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(KEY_FILE))
}

/// The Anthropic API key lives in a local config file outside the repo and
/// outside the database, so ledger exports can never leak it.
#[tauri::command]
fn get_api_key(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = key_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(v.get("api_key").and_then(|k| k.as_str()).map(String::from))
}

#[tauri::command]
fn set_api_key(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let path = key_path(&app)?;
    if key.is_empty() {
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    std::fs::write(&path, serde_json::json!({ "api_key": key }).to_string())
        .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Write export contents to a path the user picked in the save dialog.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Read a backup file from a path the user picked in the open dialog.
/// Capped at 64 MB — a backup larger than that is not one of ours.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > 64_000_000 {
        return Err("file too large to be a Moneta backup".into());
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "init",
            sql: include_str!("../migrations/0001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "balances_system_categories_goals",
            sql: include_str!("../migrations/0002_balances_system_categories_goals.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        // Must be registered first: a second launch focuses the existing
        // window instead of opening another process — two processes writing
        // one SQLite file is how "database is locked" happens.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        // File + console logging. Release builds write to the platform log
        // dir (macOS: ~/Library/Logs/com.moneta.app/moneta.log).
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("moneta".into()),
                    }),
                ])
                .max_file_size(2_000_000)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:moneta.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_api_key,
            set_api_key,
            write_text_file,
            read_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
