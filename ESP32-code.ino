#include <DHT.h>

#define DHT_PIN 11
#define DHT_TYPE DHT11

DHT dhtSensor(DHT_PIN, DHT_TYPE);

int pirSensorPin = 21;
int ldrSensorPin = 10;
int micSensorPin = 12;

void setup() {
  Serial.begin(115200);
  dhtSensor.begin();
  pinMode(pirSensorPin, INPUT);
}

void loop() {

  int motionDetected = digitalRead(pirSensorPin);
  int lightValue = analogRead(ldrSensorPin);

  long soundSum = 0;
  for (int i = 0; i < 10; i++) {
    soundSum += analogRead(micSensorPin);
    delay(2);
  }
  int soundAverage = soundSum / 10;

  float temperature = dhtSensor.readTemperature();
  float humidity = dhtSensor.readHumidity();

  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("{\"error\":\"dht\"}");
    delay(500);
    return;
  }

  // JSON output (clean + stable)
  Serial.print("{");
  Serial.print("\"temp\":"); Serial.print(temperature, 1);
  Serial.print(",\"noise\":"); Serial.print(soundAverage);
  Serial.print(",\"light\":"); Serial.print(lightValue);
  Serial.print(",\"motion\":"); Serial.print(motionDetected);
  Serial.print(",\"humidity\":"); Serial.print(humidity, 1);
  Serial.println("}");

  Serial.flush(); 
  delay(1000);
}