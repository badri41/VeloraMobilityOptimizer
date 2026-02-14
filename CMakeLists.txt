cmake_minimum_required(VERSION 3.20)
project(VeloraMobilityOptimizer CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# Use local find modules if they exist
list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")

# Print configuration info
message(STATUS "=== VeloraMobilityOptimizer Build Configuration ===")
message(STATUS "CMake Version: ${CMAKE_VERSION}")
message(STATUS "C++ Standard: C++${CMAKE_CXX_STANDARD}")
message(STATUS "Build Type: ${CMAKE_BUILD_TYPE}")

# Main solver subdirectory (required)
add_subdirectory(solver)

# Optional backend/frontend subprojects
if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/backend/CMakeLists.txt")
    add_subdirectory(backend)
else()
    message(STATUS "Backend CMakeLists.txt not found, skipping backend build")
endif()

if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/frontend/CMakeLists.txt")
    add_subdirectory(frontend)
else()
    message(STATUS "Frontend CMakeLists.txt not found, skipping frontend build")
endif()

message(STATUS "=== Project configuration complete ===")
