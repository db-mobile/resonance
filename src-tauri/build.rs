fn main() {
    let protoc = protoc_bin_vendored::protoc_bin_path().unwrap();

    let mut prost_config = prost_build::Config::new();
    prost_config.protoc_executable(&protoc);

    tonic_build::configure()
        .build_server(false)
        .type_attribute(".", "#[allow(clippy::enum_variant_names)]")
        .compile_protos_with_config(
            prost_config,
            &["proto/grpc/reflection/v1/reflection.proto"],
            &["proto"],
        )
        .unwrap();

    prost_build::Config::new()
        .protoc_executable(&protoc)
        .type_attribute(".", "#[allow(clippy::enum_variant_names)]")
        .compile_protos(
            &["proto/grpc/reflection/v1alpha/reflection.proto"],
            &["proto"],
        )
        .unwrap();

    tauri_build::build()
}
