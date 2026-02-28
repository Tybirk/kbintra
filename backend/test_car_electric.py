def test_update_car_is_electric(api_client, user_with_house, car):
    api_client.force_authenticate(user=user_with_house)
    response = api_client.patch(
        f"/api/houses/my/cars/{car.id}/",
        {"license_plate": car.license_plate, "is_electric": True},
        format="json",
    )
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")
    assert response.status_code == 200
    car.refresh_from_db()
    assert car.is_electric is True
