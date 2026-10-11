fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["settings_ready"])),
    )
    .expect("Failed to build the settings window")
}
