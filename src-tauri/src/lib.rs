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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "init",
        sql: include_str!("../migrations/0001_init.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:moneta.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![get_api_key, set_api_key])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
