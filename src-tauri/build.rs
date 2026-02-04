fn main() {
    let protoc = protoc_bin_vendored::protoc_bin_path().unwrap();
    std::env::set_var("PROTOC", protoc);

    tonic_build::configure()
        .build_server(false)
        .type_attribute(".", "#[allow(clippy::enum_variant_names)]")
        .compile(
            &["proto/grpc/reflection/v1alpha/reflection.proto"],
            &["proto"],
        )
        .unwrap();

    tauri_build::build()
}
