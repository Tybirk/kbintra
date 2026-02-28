"""
Tests for the Houses app.
"""

import pytest

from apps.houses.models import Car, Child


@pytest.fixture
def child(db, house):
    """Create a test child."""
    return Child.objects.create(
        house=house,
        name="Test Child",
    )


@pytest.fixture
def car(db, house):
    """Create a test car."""
    return Car.objects.create(
        house=house,
        license_plate="AB12345",
        is_electric=False,
    )


# =============================================================================
# Model Tests
# =============================================================================


class TestHouseModel:
    """Tests for the House model."""

    def test_house_str(self, house):
        """Test string representation of house."""
        assert str(house) == "House 1"

    def test_house_inhabitant_count(self, house, user_with_house):
        """Test that inhabitant count is tracked."""
        assert house.inhabitants.count() == 1


class TestChildModel:
    """Tests for the Child model."""

    def test_child_str(self, child):
        """Test string representation of child."""
        assert "Test Child" in str(child)

    def test_child_ordering(self, db, house):
        """Test that children are ordered by name."""
        child_b = Child.objects.create(house=house, name="Bob")
        child_a = Child.objects.create(house=house, name="Alice")

        children = list(Child.objects.filter(house=house))
        assert children[0] == child_a
        assert children[1] == child_b


class TestCarModel:
    """Tests for the Car model."""

    def test_car_str(self, car):
        """Test string representation of car."""
        assert "AB12345" in str(car)

    def test_car_ordering(self, db, house):
        """Test that cars are ordered by license plate."""
        car_b = Car.objects.create(house=house, license_plate="CD67890")
        car_a = Car.objects.create(house=house, license_plate="AB12345")

        cars = list(Car.objects.filter(house=house))
        assert cars[0] == car_a
        assert cars[1] == car_b


# =============================================================================
# API Tests
# =============================================================================


class TestHouseAPI:
    """Tests for the House API endpoints."""

    def test_list_houses_unauthenticated(self, api_client):
        """Test that unauthenticated users cannot list houses."""
        response = api_client.get("/api/houses/")
        assert response.status_code == 401

    def test_list_houses(self, authenticated_client, house, house2):
        """Test listing houses."""
        response = authenticated_client.get("/api/houses/")
        assert response.status_code == 200

        data = response.json()
        # Houses endpoint is not paginated
        results = data if isinstance(data, list) else data.get("results", data)
        assert len(results) == 2

    def test_get_house_detail(self, authenticated_client, house):
        """Test getting house details."""
        response = authenticated_client.get(f"/api/houses/{house.id}/")
        assert response.status_code == 200
        assert response.json()["name"] == "House 1"


class TestMyHouseAPI:
    """Tests for the My House API endpoints."""

    def test_get_my_house_without_house(self, authenticated_client):
        """Test getting my house when user has no house."""
        response = authenticated_client.get("/api/houses/my/")
        assert response.status_code == 404

    def test_get_my_house(self, api_client, user_with_house):
        """Test getting my house."""
        api_client.force_authenticate(user=user_with_house)
        response = api_client.get("/api/houses/my/")
        assert response.status_code == 200
        assert response.json()["name"] == "House 1"

    def test_update_my_house(self, api_client, user_with_house):
        """Test updating my house description."""
        api_client.force_authenticate(user=user_with_house)
        response = api_client.patch(
            "/api/houses/my/",
            {"description": "Updated description"},
            format="multipart",
        )
        assert response.status_code == 200
        user_with_house.house.refresh_from_db()
        assert user_with_house.house.description == "Updated description"


class TestChildAPI:
    """Tests for the Child API endpoints."""

    def test_list_children_without_house(self, authenticated_client):
        """Test listing children when user has no house."""
        response = authenticated_client.get("/api/houses/my/children/")
        assert response.status_code == 200
        data = response.json()
        results = data if isinstance(data, list) else data.get("results", data)
        assert len(results) == 0

    def test_list_children(self, api_client, user_with_house, child):
        """Test listing children in user's house."""
        api_client.force_authenticate(user=user_with_house)
        response = api_client.get("/api/houses/my/children/")
        assert response.status_code == 200

        data = response.json()
        results = data if isinstance(data, list) else data.get("results", data)
        assert len(results) == 1
        assert results[0]["name"] == "Test Child"

    def test_create_child(self, api_client, user_with_house):
        """Test creating a child."""
        api_client.force_authenticate(user=user_with_house)
        response = api_client.post(
            "/api/houses/my/children/",
            {"name": "New Kid"},
            format="json",
        )
        assert response.status_code == 201
        assert Child.objects.filter(name="New Kid").exists()

    def test_cannot_create_child_without_house(self, authenticated_client):
        """Test that users without a house cannot create children."""
        response = authenticated_client.post(
            "/api/houses/my/children/",
            {"name": "New Kid"},
            format="json",
        )
        assert response.status_code == 403

    def test_update_child(self, api_client, user_with_house, child):
        """Test updating a child."""
        api_client.force_authenticate(user=user_with_house)
        response = api_client.patch(
            f"/api/houses/my/children/{child.id}/",
            {"name": "Updated Name"},
            format="json",
        )
        assert response.status_code == 200
        child.refresh_from_db()
        assert child.name == "Updated Name"

    def test_delete_child(self, api_client, user_with_house, child):
        """Test deleting a child."""
        api_client.force_authenticate(user=user_with_house)
        response = api_client.delete(f"/api/houses/my/children/{child.id}/")
        assert response.status_code == 204
        assert not Child.objects.filter(id=child.id).exists()


class TestCarAPI:
    """Tests for the Car API endpoints."""

    def test_list_cars_without_house(self, authenticated_client):
        """Test listing cars when user has no house."""
        response = authenticated_client.get("/api/houses/my/cars/")
        assert response.status_code == 200
        data = response.json()
        results = data if isinstance(data, list) else data.get("results", data)
        assert len(results) == 0

    def test_list_cars(self, api_client, user_with_house, car):
        """Test listing cars in user's house."""
        api_client.force_authenticate(user=user_with_house)
        response = api_client.get("/api/houses/my/cars/")
        assert response.status_code == 200

        data = response.json()
        results = data if isinstance(data, list) else data.get("results", data)
        assert len(results) == 1
        assert results[0]["license_plate"] == "AB12345"

    def test_create_car(self, api_client, user_with_house):
        """Test creating a car."""
        api_client.force_authenticate(user=user_with_house)
        response = api_client.post(
            "/api/houses/my/cars/",
            {"license_plate": "XY98765", "is_electric": True},
            format="json",
        )
        assert response.status_code == 201
        assert Car.objects.filter(license_plate="XY98765").exists()
        assert Car.objects.get(license_plate="XY98765").is_electric is True

    def test_cannot_create_car_without_house(self, authenticated_client):
        """Test that users without a house cannot create cars."""
        response = authenticated_client.post(
            "/api/houses/my/cars/",
            {"license_plate": "XY98765"},
            format="json",
        )
        assert response.status_code == 403

    def test_update_car(self, api_client, user_with_house, car):
        """Test updating a car."""
        api_client.force_authenticate(user=user_with_house)
        response = api_client.patch(
            f"/api/houses/my/cars/{car.id}/",
            {"license_plate": "ZZ99999"},
            format="json",
        )
        assert response.status_code == 200
        car.refresh_from_db()
        assert car.license_plate == "ZZ99999"

    def test_delete_car(self, api_client, user_with_house, car):
        """Test deleting a car."""
        api_client.force_authenticate(user=user_with_house)
        response = api_client.delete(f"/api/houses/my/cars/{car.id}/")
        assert response.status_code == 204
        assert not Car.objects.filter(id=car.id).exists()

    def test_cars_included_in_house_detail(self, api_client, user_with_house, car):
        """Test that cars are included in house detail response."""
        api_client.force_authenticate(user=user_with_house)
        response = api_client.get(f"/api/houses/{user_with_house.house.id}/")
        assert response.status_code == 200
        assert len(response.json()["cars"]) == 1
        assert response.json()["cars"][0]["license_plate"] == "AB12345"

    def test_update_car_electric_flag(self, api_client, user_with_house, car):
        """Test updating is_electric flag from False to True."""
        api_client.force_authenticate(user=user_with_house)
        assert car.is_electric is False
        response = api_client.patch(
            f"/api/houses/my/cars/{car.id}/",
            {"license_plate": car.license_plate, "is_electric": True},
            format="json",
        )
        print(f"Response status: {response.status_code}")
        print(f"Response data: {response.json()}")
        assert response.status_code == 200
        car.refresh_from_db()
        assert car.is_electric is True
