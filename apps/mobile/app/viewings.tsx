import React from "react";
import { View } from "react-native";
import { SignInRequired } from "../src/components";
import { ViewingsList } from "../src/features/ViewingsList";
import { useTheme } from "../src/theme";

export default function Viewings() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SignInRequired>
        <ViewingsList />
      </SignInRequired>
    </View>
  );
}
