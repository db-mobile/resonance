fn main() {
    let protoc = protoc_bin_vendored::protoc_bin_path().unwrap();

    // Reflection uses a hand-written client; only the wire message types are needed.
    prost_build::Config::new()
        .protoc_executable(&protoc)
        .type_attribute(".", "#[allow(clippy::enum_variant_names)]")
        .compile_protos(
            &[
                "proto/grpc/reflection/v1/reflection.proto",
                "proto/grpc/reflection/v1alpha/reflection.proto",
            ],
            &["proto"],
        )
        .unwrap();

    tauri_build::build()
}
