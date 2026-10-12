//! CPU support check. Release builds of whisper.cpp target x86-64 with AVX2, FMA and F16C
//! (GGML_NATIVE=OFF, see .github/workflows/release.yml); running them on an older CPU would
//! crash with an illegal instruction, so the app checks first and explains instead.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CpuSupport {
    pub supported: bool,
    /// Missing instruction sets, e.g. ["AVX2"]; empty when supported.
    pub missing: Vec<&'static str>,
}

/// What this machine's CPU lacks for transcription (always supported off x86-64).
pub fn check() -> CpuSupport {
    let mut missing = missing_features();
    // Development aid: KREOKIT_DEV_MISSING_CPU=AVX2 simulates an unsupported CPU.
    if cfg!(debug_assertions) && std::env::var("KREOKIT_DEV_MISSING_CPU").as_deref() == Ok("AVX2") {
        missing.push("AVX2");
    }
    CpuSupport {
        supported: missing.is_empty(),
        missing,
    }
}

#[cfg(target_arch = "x86_64")]
fn missing_features() -> Vec<&'static str> {
    let mut missing = Vec::new();
    if !std::arch::is_x86_feature_detected!("avx2") {
        missing.push("AVX2");
    }
    if !std::arch::is_x86_feature_detected!("fma") {
        missing.push("FMA");
    }
    if !std::arch::is_x86_feature_detected!("f16c") {
        missing.push("F16C");
    }
    missing
}

#[cfg(not(target_arch = "x86_64"))]
fn missing_features() -> Vec<&'static str> {
    Vec::new()
}

/// The message shown when transcription can't run on this CPU.
pub fn unsupported_message(missing: &[&str]) -> String {
    format!(
        "This CPU isn't supported yet: transcription needs a processor with {} \
         (most Intel CPUs from 2013 and AMD CPUs from 2015 on). You can still open, edit \
         and export existing projects.",
        missing.join(", ")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explains_what_is_missing() {
        assert!(unsupported_message(&["AVX2", "FMA"]).contains("needs a processor with AVX2, FMA"));
    }

    #[test]
    fn reports_consistently() {
        let s = check();
        assert_eq!(s.supported, s.missing.is_empty());
    }
}
