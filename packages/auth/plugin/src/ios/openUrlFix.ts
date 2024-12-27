import { ConfigPlugin, withAppDelegate, ExportedConfigWithProps } from '@expo/config-plugins';
import type { ExpoConfig } from '@expo/config/build/Config.types';
import type { AppDelegateProjectFile } from '@expo/config-plugins/build/ios/Paths';
import { mergeContents } from '@expo/config-plugins/build/utils/generateCode';
import { PluginConfigType } from '../pluginConfig';

export const withIosCaptchaOpenUrlFix: ConfigPlugin<PluginConfigType> = (config, props) => {
  if (shouldApplyIosOpenUrlFix({ config, props })) {
    config = withAppDelegate(config, config => {
      return withOpenUrlFixForCaptcha({ config });
    });
  }
  return config;
};

// Interpret the plugin config to determine whether this fix should be applied
export function shouldApplyIosOpenUrlFix({
  config,
  props,
}: {
  config: ExpoConfig;
  props: PluginConfigType;
}): boolean {
  const flag = props.ios?.captchaOpenUrlFix;
  if (flag === undefined || flag === 'default') {
    // by default, apply the fix whenever 'expo-router' is detected in the same project
    return isPluginEnabled(config, 'expo-router');
  } else if (flag === true || flag === false) {
    const isEnabled: boolean = flag;
    return isEnabled;
  } else {
    throw new Error(`Unexpected value for 'captchaOpenUrlFix' config option`);
  }
}

const skipOpenUrlForFirebaseAuthBlock = `\
  if ([url.host caseInsensitiveCompare:@"firebaseauth"] == NSOrderedSame) {
    // invocations for Firebase Auth are handled elsewhere and should not be forwarded to Expo Router
    return NO;
  }\
`;

// NOTE: `mergeContents()` requires that this pattern not match newlines
const appDelegateOpenUrlInsertionPointAfter =
  /-\s*\(\s*BOOL\s*\)\s*application\s*:\s*\(\s*UIApplication\s*\*\s*\)\s*application\s+openURL\s*:\s*\(\s*NSURL\s*\*\s*\)\s*url\s+options\s*:\s*\(\s*NSDictionary\s*<\s*UIApplicationOpenURLOptionsKey\s*,\s*id\s*>\s*\*\s*\)\s*options\s*/; // 🙈

export function withOpenUrlFixForCaptcha({
  config,
}: {
  config: ExportedConfigWithProps<AppDelegateProjectFile>;
}) {
  const { language, contents } = config.modResults;

  if (['objc', 'objcpp'].includes(language)) {
    const newContents = modifyObjcAppDelegate(contents);
    return {
      ...config,
      modResults: {
        ...config.modResults,
        contents: newContents,
      },
    };
  } else {
    // TODO: Support Swift
    throw new Error(`Don't know how to apply openUrlFix to AppDelegate of language "${language}"`);
  }
}

export function modifyObjcAppDelegate(contents: string): string {
  const multilineMatcher = new RegExp(
    appDelegateOpenUrlInsertionPointAfter.source + '\\s*{\\s*\\n',
  );
  const fullMatch = contents.match(multilineMatcher);
  if (!fullMatch) {
    throw new Error("Failed to find insertion point; expected newline after '{'");
  }
  const fullMatchNumLines = fullMatch[0].split('\n').length;
  const offset = fullMatchNumLines - 1;
  if (offset < 0) {
    throw new Error(`Failed to find insertion point; fullMatchNumLines=${fullMatchNumLines}`);
  }
  return mergeContents({
    tag: '@react-native-firebase/auth-openURL',
    src: contents,
    newSrc: skipOpenUrlForFirebaseAuthBlock,
    anchor: appDelegateOpenUrlInsertionPointAfter,
    offset,
    comment: '//',
  }).contents;
}

export type ExpoConfigPluginEntry = string | [] | [string] | [string, any];

// Search the ExpoConfig plugins array to see if `pluginName` is present
function isPluginEnabled(config: ExpoConfig, pluginName: string): boolean {
  if (config.plugins === undefined) {
    return false;
  }
  return config.plugins.some((plugin: ExpoConfigPluginEntry) => {
    if (plugin === pluginName) {
      return true;
    } else if (Array.isArray(plugin) && plugin.length >= 1 && plugin[0] === pluginName) {
      return true;
    } else {
      return false;
    }
  });
}
