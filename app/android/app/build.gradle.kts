import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    // Applies the Firebase configuration from android/app/google-services.json.
    if (file("google-services.json").exists()) id("com.google.gms.google-services")
}

// Load the release signing credentials from android/key.properties when present.
// Keeping a single, stable keystore is what makes in-app updates install over an
// existing build — Android refuses an update signed with a different key. Without
// the file (e.g. a fresh clone) we fall back to debug signing so the app still
// builds out of the box.
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
val hasReleaseKeystore = keystorePropertiesFile.exists()
if (hasReleaseKeystore) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

android {
    namespace = "com.gravijet.ping"
    compileSdk = 36
    ndkVersion = flutter.ndkVersion

    compileOptions {
        // Required by flutter_local_notifications (it uses java.time APIs).
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.gravijet.ping"
        // flutter_local_notifications needs API 21+.
        minSdk = maxOf(flutter.minSdkVersion, 23)
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                storeFile = rootProject.file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            // Sign with the stable release keystore so updates install over an
            // existing install; fall back to the debug key on a fresh clone.
            signingConfig = if (hasReleaseKeystore) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }

    // --- Per-ABI splits WITHOUT version-code inflation -----------------------
    // Ping is sideloaded (website download + in-app OTA), never shipped through
    // Google Play, so we deliberately AVOID Flutter's own `--split-per-abi`: that
    // path stamps each split with an inflated version code (base + 1000·abiIndex
    // → 1042 / 2042 / 4042), which makes Android reject the universal APK as a
    // *downgrade* once a split is installed → the infamous "App nicht installiert"
    // on reinstall. AGP's native ABI splits instead keep every split on the same
    // base version code as the universal, so any APK installs cleanly over any
    // other. Build with a plain `flutter build apk --release` (NOT
    // `--split-per-abi`); this produces app-<abi>-release.apk + the universal.
    splits {
        abi {
            isEnable = true
            reset()
            include("armeabi-v7a", "arm64-v8a", "x86_64")
            isUniversalApk = true
        }
    }
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
