package be.gezinsbord.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BatteryPlugin.class);
        registerPlugin(KioskPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
